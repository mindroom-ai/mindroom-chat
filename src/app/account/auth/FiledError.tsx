import { Box, Icon, Icons, Text, color } from 'folds';

/** An error under a form field, announced to screen readers; `id` lets the field name it. */
export function FieldError({ id, message }: { id?: string; message: string }) {
  return (
    <Box id={id} role="alert" gap="100" alignItems="Center" style={{ color: color.Critical.Main }}>
      <Icon size="50" filled src={Icons.Warning} />
      <Text size="T200">{message}</Text>
    </Box>
  );
}
