import type { ComponentProps } from 'react';
import { Text } from 'folds';
import { ownDirectionLine } from '../ui/directional';
import { splitUserIdSuffix } from './room';

/** Stands for the name in `text`, to find the words before and after it. */
const NAME_MARK = '';

type NameWithUserIdProps = Omit<ComponentProps<typeof Text>, 'children' | 'truncate'> & {
  /** The name as `getSenderName` or `getRoomMemberName` gives it, the user ID after it or not. */
  name: string;
  userId: string;
  /** The words the name shows in, such as a translation of `{{name}}`; the name alone without. */
  text?: (name: string) => string;
};

/**
 * A member's name in a line that may be too narrow for it: an ellipsis may cut the display name
 * short, never the user ID after it, which tells a copied name apart. The display name (with the
 * words of `text` before it) and the ID (with the words after it) are two items of the wrapping
 * flex row around them, so on a narrow line the ID moves onto the next line, and a very long one
 * breaks across lines; the row's column gap stands for the space between them. A name without
 * the ID shows as one item, which an ellipsis may cut.
 */
export function NameWithUserId({
  name,
  userId,
  text = (shown) => shown,
  style,
  ...textProps
}: NameWithUserIdProps) {
  const [displayName, userIdSuffix] = splitUserIdSuffix(name, userId);
  const marked = text(NAME_MARK);
  const at = marked.indexOf(NAME_MARK);
  if (!userIdSuffix || at < 0) {
    return (
      <Text as="span" truncate {...ownDirectionLine} {...textProps} style={style}>
        {text(name)}
      </Text>
    );
  }
  return (
    <>
      <Text as="span" truncate {...ownDirectionLine} {...textProps} style={style}>
        {marked.slice(0, at)}
        {displayName}
      </Text>
      <Text as="span" {...textProps} style={{ minWidth: 0, overflowWrap: 'anywhere', ...style }}>
        {userIdSuffix}
        {marked.slice(at + NAME_MARK.length)}
      </Text>
    </>
  );
}
