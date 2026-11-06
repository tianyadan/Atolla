/**
 * ChatGPT 网页适配器。
 *
 * 此函数会被 chrome.scripting.executeScript 序列化后注入页面，因此必须保持自包含，
 * 不可引用模块作用域变量。ChatGPT 页面结构变化时，只需维护本文件中的语义探测规则。
 */
export function runChatGPTPageTask(promptText, replyTimeoutMS) {
  return new Promise((resolve) => {
    const adapterVersion = '2026-11-05'
    const selectors = {
      composer: [
        'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"]',
        '[data-composer-markdown][contenteditable="true"][role="textbox"]',
        '#prompt-textarea',
        'textarea[data-testid="prompt-textarea"]',
        'textarea#pending-home-input',
        '[contenteditable="true"][data-lexical-editor="true"]',
        '[role="textbox"][contenteditable="true"][aria-label*="ChatGPT"]',
      ],
      sendButton: [
        'button[data-testid="send-button"]',
        'button[data-testid="composer-submit-button"]',
        'button[data-testid="composer-send-button"]',
        'form[data-chatgpt-composer] button[type="submit"]',
      ],
      assistantUnit: [
        '[data-content-search-unit-key$=":assistant"]',
        '[data-chatgpt-search-unit-key$=":assistant"]',
        '[data-message-author-role="assistant"]',
      ],
      assistantText: [
        '[data-markdown-text-style="assistant-message"]',
        '[data-message-author-role="assistant"]',
        '.markdown.prose',
      ],
      stopButton: [
        'button[data-testid="stop-button"]',
        'button[data-testid="composer-stop-button"]',
      ],
    }

    let observer
    let pollTimer
    let timeoutTimer
    let sentAt = 0
    let lastText = ''
    let stableSince = 0
    let sawGenerating = false
    let generationFinishedAt = 0
    let baseline = { count: 0, key: '', text: '' }

    const visible = (element) => Boolean(
      element &&
      element.getClientRects().length > 0 &&
      !element.disabled &&
      element.getAttribute('aria-disabled') !== 'true'
    )
    const firstVisible = (candidates) => {
      for (const selector of candidates) {
        const element = [...document.querySelectorAll(selector)].find(visible)
        if (element) return { element, selector }
      }
      return null
    }
    const textOf = (element) => String(element?.innerText || element?.textContent || '').trim()
    const assistantUnits = () => [...document.querySelectorAll(selectors.assistantUnit.join(','))]
      .filter((element) => element instanceof HTMLElement)
    const assistantKey = (element, index) => String(
      element?.getAttribute('data-chatgpt-search-message-ids') ||
      element?.getAttribute('data-content-search-unit-key') ||
      element?.getAttribute('data-chatgpt-search-unit-key') ||
      `assistant-index-${index}`
    )
    const assistantText = (unit) => {
      if (!unit) return ''
      for (const selector of selectors.assistantText) {
        const textElement = unit.matches(selector) ? unit : unit.querySelector(selector)
        const value = textOf(textElement)
        if (value) return value
      }
      return textOf(unit)
    }
    const assistantSnapshot = () => {
      const units = assistantUnits()
      const last = units.at(-1)
      return {
        count: units.length,
        key: assistantKey(last, units.length - 1),
        text: assistantText(last),
      }
    }
    const buttonLabel = (button) => String(
      button?.getAttribute('aria-label') ||
      button?.getAttribute('title') ||
      button?.innerText ||
      button?.textContent ||
      ''
    ).trim()
    const findComposer = () => firstVisible(selectors.composer)
    const findSendButton = () => firstVisible(selectors.sendButton) || (() => {
      const element = [...document.querySelectorAll('button')].find((button) => (
        visible(button) && /^(send|发送|传送)(\s|$)/i.test(buttonLabel(button))
      ))
      return element ? { element, selector: 'button[semantic-label=send]' } : null
    })()
    const isGenerating = () => {
      if (firstVisible(selectors.stopButton)) return true
      return [...document.querySelectorAll('button')].some((button) => (
        visible(button) && /^(stop|停止)(\s|$)/i.test(buttonLabel(button))
      ))
    }
    const loginRequired = () => [...document.querySelectorAll('a, button')].some((element) => {
      const label = String(
        element.innerText || element.textContent || element.getAttribute('aria-label') || ''
      ).trim()
      return visible(element) && /^(log in|sign in|登录)$/i.test(label)
    })
    const selectorHits = (group) => Object.fromEntries(
      selectors[group].map((selector) => [selector, document.querySelectorAll(selector).length])
    )
    const candidateAttributes = (element) => {
      if (!element) return undefined
      const allowed = ['id', 'role', 'contenteditable', 'data-testid', 'data-composer-markdown', 'data-content-search-unit-key', 'data-chatgpt-search-unit-key']
      return Object.fromEntries(allowed
        .map((name) => [name, element.getAttribute(name)])
        .filter(([, value]) => value !== null))
    }
    const collectDiagnostics = () => ({
      adapter_version: adapterVersion,
      url: location.href,
      title: document.title,
      login_required: loginRequired(),
      generating: isGenerating(),
      selector_hits: {
        composer: selectorHits('composer'),
        send_button: selectorHits('sendButton'),
        assistant_unit: selectorHits('assistantUnit'),
        stop_button: selectorHits('stopButton'),
      },
      candidates: {
        contenteditable: [...document.querySelectorAll('[contenteditable="true"]')].slice(0, 5).map(candidateAttributes),
        assistant: assistantUnits().slice(-3).map(candidateAttributes),
      },
    })
    const cleanup = () => {
      observer?.disconnect()
      clearInterval(pollTimer)
      clearTimeout(timeoutTimer)
    }
    const finish = (payload) => {
      cleanup()
      resolve(payload)
    }
    const fail = (error, code) => finish({
      ok: false,
      error,
      code,
      diagnostics: collectDiagnostics(),
    })
    const inspectReply = () => {
      if (!sentAt) return
      const generating = isGenerating()
      if (generating) {
        sawGenerating = true
        generationFinishedAt = 0
      } else if (sawGenerating && !generationFinishedAt) {
        generationFinishedAt = Date.now()
      }
      const current = assistantSnapshot()
      const isNewReply = current.count > baseline.count ||
        current.key !== baseline.key ||
        (current.text && current.text !== baseline.text)
      if (!isNewReply || !current.text) {
        if (generationFinishedAt && Date.now() - generationFinishedAt >= 1500) {
          fail('ChatGPT 已结束生成，但未识别到 Assistant 回复，页面结构可能已经更新', 'CHATGPT_RESPONSE_NOT_FOUND')
        }
        return
      }
      if (current.text !== lastText) {
        lastText = current.text
        stableSince = Date.now()
        return
      }
      // 回复文本稳定、生成状态结束后，才把最新 Assistant 单元作为本轮结果。
      if (!generating && stableSince && Date.now() - stableSince >= 1200) {
        finish({
          ok: true,
          response: current.text,
          conversation_url: location.href,
          title: document.title,
          adapter_version: adapterVersion,
        })
      }
    }
    const setComposerText = (element) => {
      element.focus()
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        const prototype = element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
        if (setter) setter.call(element, promptText)
        else element.value = promptText
      } else if (element.isContentEditable) {
        const selection = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(element)
        selection?.removeAllRanges()
        selection?.addRange(range)
        if (!document.execCommand('insertText', false, promptText)) element.textContent = promptText
      } else {
        return false
      }
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: promptText,
      }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    const start = async () => {
      // DOM 不匹配通常意味着页面已改版，最长等待 5 秒后立即返回诊断，避免占满整个任务超时。
      const composerDeadline = Date.now() + Math.min(5000, Math.max(1500, replyTimeoutMS / 20))
      let composerMatch
      while (Date.now() < composerDeadline && !composerMatch) {
        composerMatch = findComposer()
        if (!composerMatch) await new Promise((resume) => setTimeout(resume, 200))
      }
      if (!composerMatch) {
        if (loginRequired()) fail('ChatGPT 登录状态已失效，请重新登录', 'CHATGPT_LOGIN_REQUIRED')
        else fail('未识别到 ChatGPT 输入框，页面结构可能已经更新', 'CHATGPT_COMPOSER_NOT_FOUND')
        return
      }
      if (isGenerating()) {
        fail('ChatGPT 当前仍在生成上一条回复', 'CHATGPT_GENERATING')
        return
      }

      baseline = assistantSnapshot()
      if (!setComposerText(composerMatch.element)) {
        fail('ChatGPT 输入框不可编辑', 'CHATGPT_INPUT_UNAVAILABLE')
        return
      }

      const sendDeadline = Date.now() + 3000
      let sendMatch
      while (Date.now() < sendDeadline && !sendMatch) {
        sendMatch = findSendButton()
        if (!sendMatch) await new Promise((resume) => setTimeout(resume, 100))
      }
      if (!sendMatch) {
        fail('未找到可用的 ChatGPT 发送按钮', 'CHATGPT_SEND_UNAVAILABLE')
        return
      }

      sentAt = Date.now()
      sendMatch.element.click()
      observer = new MutationObserver(inspectReply)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-label', 'data-testid', 'disabled'],
      })
      pollTimer = setInterval(inspectReply, 250)
    }

    timeoutTimer = setTimeout(() => {
      fail(
        lastText ? '等待 ChatGPT 完成回复超时' : '等待 ChatGPT 返回回复超时',
        'CHATGPT_RESPONSE_TIMEOUT'
      )
    }, replyTimeoutMS)
    start().catch((error) => fail(
      error?.message || 'ChatGPT 页面操作失败',
      'CHATGPT_PAGE_ERROR'
    ))
  })
}
