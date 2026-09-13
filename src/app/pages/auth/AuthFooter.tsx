import React from 'react';
import { Box, Text } from 'folds';
import * as css from './styles.css';

export function AuthFooter() {
  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      <Text size="T300">
        Powered by{' '}
        <a href="https://github.com/mindroom-ai/mindroom-cinny" target="_blank" rel="noreferrer">
          MindRoom
        </a>
        ,{' '}
        <a href="https://matrix.org" target="_blank" rel="noreferrer">
          Matrix
        </a>
        ,{' '}
        <a href="https://github.com/ajbura/cinny" target="_blank" rel="noreferrer">
          Cinny
        </a>
      </Text>
    </Box>
  );
}
