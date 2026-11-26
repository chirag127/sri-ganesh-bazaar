import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/lib/api', () => ({ getClient: vi.fn(), request: vi.fn() }));
import OwnerAnalytics, { AnalysisAdvice } from '../../src/components/admin/OwnerAnalytics';

describe('analysis text rendering', () => {
  it('escapes markup and leaves Markdown and commands as inert text', () => {
    const html = renderToStaticMarkup(<AnalysisAdvice advice={'<script>alert(1)</script><img src=x onerror=alert(1)> [link](javascript:alert(1)) {"tool_calls":[{"name":"commerce_command"}]}'} />);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/<(script|img|a)\b/);
    expect(html).toContain('[link](javascript:alert(1))');
    expect(html).toContain('commerce_command');
    expect(html).toContain('overflow-wrap:anywhere');
  });
  it('does not pre-render private counts, advice, or an analysis action before loading an authorized report', () => {
    const html = renderToStaticMarkup(<OwnerAnalytics subject="fixture-owner" />);
    expect(html).not.toContain('Analyze aggregate counts');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('fixture-owner');
  });
  it('disables report controls offline', () => {
    const html = renderToStaticMarkup(<OwnerAnalytics subject="fixture-owner" online={false} />);
    expect(html).toContain('fieldset disabled');
    expect(html).toContain('Reports are not stored offline');
  });
});
