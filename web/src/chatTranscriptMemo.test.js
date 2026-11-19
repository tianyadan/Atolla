import test from 'node:test'
import assert from 'node:assert/strict'
import { sameChatTranscriptProps } from './chatTranscriptMemo.js'

test('typing in the composer does not invalidate unchanged chat history', () => {
  const props = {
    chatLog: [{ id: 1, role: 'assistant', content: '之前的回复' }],
    loading: false,
    selected: { id: 1, name: '同事' },
    selectedId: 1,
    authHeaders: () => ({}),
    onOpenImage: () => {},
  }
  assert.equal(sameChatTranscriptProps(props, { ...props }), true)
  assert.equal(sameChatTranscriptProps(props, { ...props, chatLog: [...props.chatLog] }), false)
  assert.equal(sameChatTranscriptProps(props, { ...props, loading: true }), false)
  assert.equal(sameChatTranscriptProps(props, { ...props, selected: { ...props.selected, name: '新名字' } }), false)
  assert.equal(sameChatTranscriptProps(props, { ...props, selectedId: 2 }), false)
})
