/** 输入框等局部状态变化不应重新遍历、构建整段历史消息。 */
export function sameChatTranscriptProps(a, b) {
  return a.chatLog === b.chatLog
    && a.loading === b.loading
    && a.selected === b.selected
    && a.selectedId === b.selectedId
    && a.authHeaders === b.authHeaders
    && a.onOpenImage === b.onOpenImage
}
