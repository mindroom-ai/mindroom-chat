import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'folds';

import { getMcpAppIframeSandbox, getMcpAppResources, type McpAppResource } from './mcpApps';

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

const asRequest = (value: unknown): JsonRpcRequest | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRpcRequest)
    : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const isRequestWithId = (
  request: JsonRpcRequest
): request is JsonRpcRequest & { id: string | number } =>
  typeof request.id === 'string' || typeof request.id === 'number';

const isSafeExternalUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

const postToFrame = (frame: HTMLIFrameElement | null, message: unknown) => {
  frame?.contentWindow?.postMessage(message, '*');
};

const response = (id: string | number, result: unknown) => ({
  jsonrpc: '2.0',
  id,
  result,
});

const errorResponse = (id: string | number, code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

function McpAppFrame({ resource }: { resource: McpAppResource }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initializedRef = useRef(false);
  const toolResultSentRef = useRef(false);
  const [height, setHeight] = useState(320);
  const title = resource.toolName ? `MCP app from ${resource.toolName}` : 'MCP app';
  const uiMeta = asRecord(resource.meta?.ui);

  const toolInputNotification = useMemo(
    () => ({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-input',
      params: resource.toolInput ?? { arguments: {} },
    }),
    [resource.toolInput]
  );

  const toolResultNotification = useMemo(
    () => ({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: resource.toolResult ?? {
        content: resource.resultPreview ? [{ type: 'text', text: resource.resultPreview }] : [],
        isError: false,
      },
    }),
    [resource.resultPreview, resource.toolResult]
  );

  const sendToolState = useCallback(() => {
    if (!initializedRef.current || toolResultSentRef.current) return;
    postToFrame(iframeRef.current, toolInputNotification);
    postToFrame(iframeRef.current, toolResultNotification);
    toolResultSentRef.current = true;
  }, [toolInputNotification, toolResultNotification]);

  useEffect(() => {
    initializedRef.current = false;
    toolResultSentRef.current = false;
  }, [resource.uri, resource.html]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;

      const request = asRequest(event.data);
      if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return;

      if (request.method === 'ui/notifications/initialized') {
        initializedRef.current = true;
        sendToolState();
        return;
      }

      if (request.method === 'ui/notifications/size-changed') {
        const params = asRecord(request.params);
        if (typeof params?.height === 'number' && Number.isFinite(params.height)) {
          setHeight(Math.min(1200, Math.max(160, Math.ceil(params.height))));
        }
        return;
      }

      if (!isRequestWithId(request)) return;

      if (request.method === 'ui/initialize' || request.method === 'initialize') {
        postToFrame(
          iframeRef.current,
          response(request.id, {
            protocolVersion: '2026-01-26',
            host: { name: 'MindRoom Cinny' },
            capabilities: {},
          })
        );
        return;
      }

      if (request.method === 'ui/open-link') {
        const params = asRecord(request.params);
        if (params && isSafeExternalUrl(params.url)) {
          window.open(params.url, '_blank', 'noopener,noreferrer');
          postToFrame(iframeRef.current, response(request.id, null));
          return;
        }
        postToFrame(iframeRef.current, errorResponse(request.id, -32602, 'Unsupported URL'));
        return;
      }

      if (request.method === 'tools/call') {
        postToFrame(
          iframeRef.current,
          errorResponse(request.id, -32601, 'MCP app tool calls are not supported yet')
        );
        return;
      }

      postToFrame(
        iframeRef.current,
        errorResponse(request.id, -32601, `Unsupported MCP Apps method: ${request.method}`)
      );
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sendToolState]);

  return (
    <Box direction="Column" gap="100" style={{ marginTop: '0.75rem' }}>
      <Text size="L400">{title}</Text>
      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={resource.html}
        sandbox={getMcpAppIframeSandbox()}
        style={{
          width: '100%',
          height,
          minHeight: '160px',
          border: uiMeta?.prefersBorder === false ? '0' : '1px solid rgba(148, 163, 184, 0.35)',
          borderRadius: '8px',
          background: 'white',
        }}
      />
    </Box>
  );
}

export function McpAppsRenderer({ content }: { content: Record<string, unknown> }) {
  const resources = getMcpAppResources(content);
  if (resources.length === 0) return null;

  return (
    <>
      {resources.map((resource) => (
        <McpAppFrame key={`${resource.uri}:${resource.toolName ?? ''}`} resource={resource} />
      ))}
    </>
  );
}
