import React, { Component, type ReactNode } from 'react';
import { reportRenderFailure } from '../lib/error-reporting';

interface Props { children: ReactNode }
interface State { failed: boolean; attempt: number }

/** Render failures only; async actions retain their existing transaction-aware handling. */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, attempt: 0 };
  static getDerivedStateFromError(): Partial<State> { return { failed: true }; }
  componentDidCatch(): void {
    // Reporter accepts no error argument and cannot expose exception or component details.
    void reportRenderFailure().catch(() => { /* Reporting must never break recovery. */ });
  }
  render() {
    if (this.state.failed) return <section className="notice error" role="alert" aria-label="Application unavailable">
      <h2>This screen could not be displayed.</h2>
      <p>Your last action may already have reached the shop. Check your order or payment history before submitting it again.</p>
      <p>Retry reloads this screen, not your transaction. Unsaved form entries may be lost.</p>
      <div className="actions">
        <button type="button" onClick={() => this.setState(state => ({ failed: false, attempt: state.attempt + 1 }))}>Retry screen</button>
        <a href="/products/">Browse the public catalog</a>
      </div>
    </section>;
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}
