import React, { Children, ReactNode, cloneElement, isValidElement, useId } from 'react';
import { Box, Text } from 'folds';

/**
 * One row of a sign-in form: the caption, then the control and anything that belongs under it.
 * The caption is the label of the row's first control, which takes a generated ID unless it has
 * one.
 */
export function AuthField({ caption, children }: { caption: string; children: ReactNode }) {
  const id = useId();
  const [first, ...rest] = Children.toArray(children);
  const field = isValidElement<{ id?: string }>(first) ? first : undefined;
  const fieldId = field?.props.id ?? id;
  return (
    <Box direction="Column" gap="100">
      <Text as="label" htmlFor={fieldId} size="L400" priority="300">
        {caption}
      </Text>
      {field ? cloneElement(field, { id: fieldId }) : first}
      {rest}
    </Box>
  );
}
