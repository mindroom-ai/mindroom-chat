import { Box, Icon, Icons, Line, Text, color, type IconSrc } from 'folds';
import React from 'react';
import type {
  CommandPaletteItem,
  CommandPaletteSectionId,
} from './commandPaletteTypes';

export type CommandPaletteListSection = {
  id: CommandPaletteSectionId;
  title: string;
  items: CommandPaletteItem[];
};

type CommandPaletteListProps = {
  sections: readonly CommandPaletteListSection[];
  selectedItemId?: string;
  onSelect: (item: CommandPaletteItem) => void;
};

type CommandPaletteItemPresentation = {
  category: CommandPaletteSectionId;
  accentColor: string;
  iconSrc?: IconSrc;
};

const getItemTitle = (item: CommandPaletteItem): string => {
  switch (item.kind) {
    case 'action':
      return item.title;
    case 'room':
    case 'space':
      return item.name;
    case 'user':
      return item.displayName;
    case 'thread':
      return item.summaryText;
    default:
      return item.title;
  }
};

const getItemDescription = (item: CommandPaletteItem): string | undefined => {
  switch (item.kind) {
    case 'action':
      return item.description;
    case 'room':
    case 'space':
      return item.topic ?? item.canonicalAlias;
    case 'user':
      return item.userId;
    case 'thread':
      return item.roomName;
    default:
      return item.description;
  }
};

const getItemPresentation = (
  item: Pick<CommandPaletteItem, 'kind'> | { kind: string }
): CommandPaletteItemPresentation | undefined => {
  // Keep the accents on existing Folds semantic families so the row markers stay theme-safe
  // across Cinny's light/dark/butter/silver palettes without introducing hardcoded colors.
  switch (item.kind) {
    case 'action':
      return {
        category: 'actions',
        accentColor: color.Warning.Main,
        iconSrc: Icons.Terminal,
      };
    case 'thread':
      return {
        category: 'threads',
        accentColor: color.Primary.Main,
        iconSrc: Icons.Message,
      };
    case 'room':
      return {
        category: 'rooms',
        accentColor: color.Success.Main,
        iconSrc: Icons.Hash,
      };
    case 'space':
      return {
        category: 'rooms',
        accentColor: color.Success.Main,
        iconSrc: Icons.Space,
      };
    case 'user':
      return {
        category: 'users',
        accentColor: color.Secondary.Main,
        iconSrc: Icons.User,
      };
    case 'message':
      return {
        category: 'messages',
        accentColor: color.SurfaceVariant.OnContainer,
        iconSrc: Icons.Search,
      };
    default:
      return undefined;
  }
};

export function CommandPaletteList({
  sections,
  selectedItemId,
  onSelect,
}: CommandPaletteListProps) {
  return (
    <Box direction="Column" gap="100">
      {sections.map((section) => (
        <Box key={section.id} direction="Column" gap="100">
          <Box direction="Column">
            {section.items.map((item, index) => {
              const itemDescription = getItemDescription(item);
              const itemPresentation = getItemPresentation(item);
              const isSelected = selectedItemId === item.id;

              return (
                <React.Fragment key={item.id}>
                  {index > 0 && <Line variant="SurfaceVariant" size="300" />}
                  <button
                    type="button"
                    data-item-id={item.id}
                    data-kind={item.kind}
                    data-category={itemPresentation?.category ?? 'unknown'}
                    data-selected={isSelected}
                    onClick={() => onSelect(item)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'flex-start',
                      padding: itemPresentation ? '14px 12px 14px 8px' : 12,
                      border: 0,
                      borderLeft: itemPresentation
                        ? `4px solid ${itemPresentation.accentColor}`
                        : undefined,
                      backgroundColor: isSelected ? color.SurfaceVariant.ContainerHover : 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        flex: '1 1 auto',
                        minWidth: 0,
                      }}
                    >
                      {itemPresentation?.iconSrc && (
                        <span
                          data-category-icon={item.kind}
                          style={{
                            display: 'inline-flex',
                            color: itemPresentation.accentColor,
                            flex: '0 0 auto',
                            paddingTop: 2,
                          }}
                        >
                          <Icon size="200" src={itemPresentation.iconSrc} />
                        </span>
                      )}
                      <Box direction="Column" gap="100" grow="Yes" style={{ minWidth: 0 }}>
                        <Text size="B400">{getItemTitle(item)}</Text>
                        {itemDescription && (
                          <Text size="T200" priority="300">
                            {itemDescription}
                          </Text>
                        )}
                      </Box>
                    </div>
                  </button>
                </React.Fragment>
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
