import { describe, expect, it } from 'vitest';

import { getMcpAppIframeSandbox, getMcpAppResources } from './mcpApps';

describe('mcpApps', () => {
  it('extracts MCP Apps resources from MindRoom tool trace metadata', () => {
    const resources = getMcpAppResources({
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'show_chart',
            result_preview: 'chart ready',
            mcp_tool_input: { arguments: { chart: 'sales' } },
            mcp_tool_result: {
              content: [{ type: 'text', text: 'chart ready' }],
              structuredContent: { chart: 'sales' },
            },
            mcp_apps: [
              {
                uri: 'ui://demo/chart',
                mime_type: 'text/html;profile=mcp-app',
                html: '<html><body>chart</body></html>',
                meta: { ui: { prefersBorder: true } },
              },
            ],
          },
        ],
      },
    });

    expect(resources).toEqual([
      {
        uri: 'ui://demo/chart',
        mimeType: 'text/html;profile=mcp-app',
        html: '<html><body>chart</body></html>',
        meta: { ui: { prefersBorder: true } },
        toolInput: { arguments: { chart: 'sales' } },
        toolResult: {
          content: [{ type: 'text', text: 'chart ready' }],
          structuredContent: { chart: 'sales' },
        },
        toolName: 'show_chart',
        resultPreview: 'chart ready',
      },
    ]);
  });

  it('rejects non-ui and non-mcp-app resources', () => {
    const resources = getMcpAppResources({
      'io.mindroom.tool_trace': {
        events: [
          {
            tool_name: 'bad',
            mcp_apps: [
              {
                uri: 'https://example.test/widget',
                mime_type: 'text/html;profile=mcp-app',
                html: '<html></html>',
              },
              {
                uri: 'ui://demo/plain',
                mime_type: 'text/html',
                html: '<html></html>',
              },
            ],
          },
        ],
      },
    });

    expect(resources).toEqual([]);
  });

  it('uses a sandbox that allows scripts without same-origin host access', () => {
    const sandbox = getMcpAppIframeSandbox();

    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-forms');
    expect(sandbox).not.toContain('allow-same-origin');
  });
});
