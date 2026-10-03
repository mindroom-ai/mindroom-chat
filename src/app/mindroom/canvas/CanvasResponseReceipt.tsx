import React from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import type { CanvasResponseReceipt as Receipt } from './canvasMessages';

// Inline styles keep this renderer free of a style module, like other message renderers.
// A non-list-item summary has no disclosure marker.
const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  display: 'inline-flex',
  listStyle: 'none',
};
const dataStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  margin: '4px 0 0',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/** A canvas commit reads as a short confirmation; clicking it reveals the exact data sent. */
export function CanvasResponseReceipt({ receipt }: { receipt: Receipt }) {
  return (
    <details data-canvas-receipt={receipt.canvasEventId}>
      <summary style={summaryStyle} title="Show the data sent to the agent">
        <Box as="span" alignItems="Center" gap="100">
          <Icon size="50" src={Icons.Check} />
          <Text as="span" size="T300" priority="300">
            {receipt.label}
          </Text>
        </Box>
      </summary>
      <Text as="pre" size="T200" style={dataStyle}>
        {receipt.json}
      </Text>
    </details>
  );
}
