import { Component } from 'react'
import { UI_MODE_CLASSIC } from './uiMode.js'

/**
 * 水母界面崩溃时仍可切回经典界面，不拖垮整页。
 */
export default class JellyErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[jelly-ui]', error, info?.componentStack)
  }

  /** 清错误并切回经典 */
  revert = () => {
    this.setState({ error: null })
    this.props.onRevertToClassic?.(UI_MODE_CLASSIC)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="jelly-error-fallback" role="alert">
          <h2>新版界面出了点问题</h2>
          <p>可以先切回经典界面继续工作，不影响审计、设置等治理页面。</p>
          <pre className="jelly-error-msg">{String(this.state.error?.message || this.state.error)}</pre>
          <button type="button" className="jelly-btn pri" onClick={this.revert}>
            切回经典界面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
