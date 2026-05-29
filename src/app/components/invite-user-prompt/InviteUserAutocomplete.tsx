import React, {
  ChangeEventHandler,
  ForwardedRef,
  KeyboardEvent as ReactKeyboardEvent,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Avatar, Icon, Icons, Input, MenuItem, Text } from 'folds';
import type { Room } from 'matrix-js-sdk';

import { useInviteUserSearch } from '../../hooks/useInviteUserSearch';
import { useListFocusIndex } from '../../hooks/useListFocusIndex';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import type { ServerUserDirectoryUser } from '../../state/userDirectoryCache';
import { getMxIdLocalPart, isUserId, mxcUrlToHttp } from '../../utils/matrix';
import { sanitizeInviteAutocompleteOptionId } from '../../utils/userDirectorySearch';
import { onTabPress } from '../../utils/keyboard';
import { UserAvatar } from '../user-avatar';
import { InviteAutocompleteMenu } from './InviteAutocompleteMenu';
import * as css from './InviteAutocompleteMenu.css';

type InviteUserAutocompleteProps = {
  room: Room;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSelect: (userId: string) => void;
  disabled?: boolean;
};

const LISTBOX_ID = 'invite-autocomplete-listbox';

const getOptionId = (userId: string): string =>
  `invite-autocomplete-option-${sanitizeInviteAutocompleteOptionId(userId)}`;

const getDisplayName = (user: ServerUserDirectoryUser): string =>
  user.displayName?.trim() || getMxIdLocalPart(user.userId) || user.userId;

const getOptionLabel = (displayName: string, userId: string): string =>
  displayName && displayName !== userId ? `${displayName}, ${userId}` : userId;

const setForwardedRef = (
  ref: ForwardedRef<HTMLInputElement>,
  element: HTMLInputElement | null
): void => {
  if (typeof ref === 'function') {
    ref(element);
    return;
  }

  if (ref) {
    ref.current = element;
  }
};

export const InviteUserAutocomplete = forwardRef<HTMLInputElement, InviteUserAutocompleteProps>(
  ({ room, inputValue, onInputChange, onSelect, disabled }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const disabledRef = useRef(Boolean(disabled));
    const [inputFocused, setInputFocused] = useState(false);
    const [closedForValue, setClosedForValue] = useState<string>();
    const { suggestions, isFetching } = useInviteUserSearch(room, inputValue);
    const { index: focusIndex, next, previous, reset } = useListFocusIndex(suggestions.length, 0);
    const clampedFocusIndex =
      suggestions.length > 0 ? Math.min(Math.max(focusIndex, 0), suggestions.length - 1) : 0;
    const activeUser = suggestions[clampedFocusIndex];
    const trimmedInputValue = inputValue.trim();
    // Preserve explicit dismissal for the current value so Escape/click-outside cannot reopen it.
    const menuOpen =
      !disabled &&
      inputFocused &&
      trimmedInputValue.length > 0 &&
      suggestions.length > 0 &&
      closedForValue !== inputValue;
    const activeOptionId = menuOpen && activeUser ? getOptionId(activeUser.userId) : undefined;

    disabledRef.current = Boolean(disabled);

    useEffect(() => {
      reset();
    }, [reset, suggestions]);

    const resultCountLabel = useMemo(() => {
      if (trimmedInputValue.length === 0) return 'Users';
      if (isFetching) return 'Searching users';
      if (suggestions.length === 0) return 'No matching users';
      return `${suggestions.length} matching user${suggestions.length === 1 ? '' : 's'}`;
    }, [isFetching, suggestions.length, trimmedInputValue.length]);

    const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
      setClosedForValue(undefined);
      onInputChange(event.currentTarget.value);
    };

    const requestClose = useCallback(() => {
      setClosedForValue(inputValue);
    }, [inputValue]);

    const commitUser = useCallback(
      (user: ServerUserDirectoryUser) => {
        if (disabledRef.current) return;

        setClosedForValue(user.userId);
        onSelect(user.userId);
      },
      [onSelect]
    );

    const handleInputRef = useCallback(
      (element: HTMLInputElement | null) => {
        setForwardedRef(ref, element);
      },
      [ref]
    );

    const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (disabledRef.current) return;
      if (!menuOpen || suggestions.length === 0) return;

      if (event.key === 'Tab' && event.shiftKey) {
        requestClose();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        next();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        previous();
        return;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && isUserId(trimmedInputValue)) {
        if (event.key === 'Tab') {
          requestClose();
        }
        return;
      }

      onTabPress(event, () => {
        if (activeUser) commitUser(activeUser);
      });

      if (menuOpen && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      }
    };

    return (
      <div>
        <InviteAutocompleteMenu
          open={menuOpen}
          requestClose={requestClose}
          input={
            <Input
              size="500"
              ref={handleInputRef}
              value={inputValue}
              onChange={handleChange}
              onKeyDown={handleInputKeyDown}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="@username:server"
              name="userIdInput"
              variant="Background"
              disabled={disabled}
              autoComplete="off"
              required
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={menuOpen}
              aria-controls={LISTBOX_ID}
              aria-activedescendant={activeOptionId}
            />
          }
          headerContent={<Text size="L400">{resultCountLabel}</Text>}
          menuId={LISTBOX_ID}
          menuLabel="Invite user suggestions"
        >
          {menuOpen && (
            <>
              {suggestions.map((user, index) => {
                const displayName = getDisplayName(user);
                const avatarUrl = user.avatarMxcUrl
                  ? mxcUrlToHttp(mx, user.avatarMxcUrl, useAuthentication, 32, 32, 'crop') ??
                    undefined
                  : undefined;
                const active = index === clampedFocusIndex;

                return (
                  <MenuItem
                    key={user.userId}
                    as="button"
                    id={getOptionId(user.userId)}
                    role="option"
                    aria-selected={active}
                    aria-label={getOptionLabel(displayName, user.userId)}
                    data-focus={active || undefined}
                    className={css.InviteAutocompleteOption}
                    type="button"
                    radii="300"
                    disabled={disabled}
                    onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
                      event.preventDefault();
                    }}
                    onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
                      onTabPress(event, () => {
                        event.stopPropagation();
                        commitUser(user);
                      });
                    }}
                    onClick={() => commitUser(user)}
                    before={
                      <Avatar size="200">
                        <UserAvatar
                          userId={user.userId}
                          src={avatarUrl}
                          alt={displayName}
                          renderFallback={() => <Icon size="50" src={Icons.User} filled />}
                        />
                      </Avatar>
                    }
                  >
                    <span className={css.InviteAutocompleteIdentity}>
                      <Text
                        as="span"
                        className={css.InviteAutocompleteDisplayName}
                        size="B400"
                        title={displayName}
                      >
                        {displayName}
                      </Text>
                      <Text
                        as="span"
                        className={css.InviteAutocompleteUserId}
                        size="T200"
                        priority="300"
                        title={user.userId}
                      >
                        {user.userId}
                      </Text>
                    </span>
                  </MenuItem>
                );
              })}
            </>
          )}
        </InviteAutocompleteMenu>
      </div>
    );
  }
);
