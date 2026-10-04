import React, { useState } from 'react';
import { color, Text } from 'folds';
import { ModelPicker } from '../../src/app/mindroom/models/ModelPicker';
import { ScreenSizeProvider, useScreenSize } from '../../src/app/hooks/useScreenSize';
import { FilterBarMobileSheet } from '../../src/app/pages/client/threads/FilterBarMobileSheet';
import { InviteAutocompleteMenu } from '../../src/app/components/invite-user-prompt/InviteAutocompleteMenu';
import { AutocompleteMenu } from '../../src/app/components/editor/autocomplete/AutocompleteMenu';

/** Real menu components with deterministic data; no backend or external model calls. */
export function DialogMenusGlass() {
  const screenSize = useScreenSize();
  const [filters, setFilters] = useState(false);
  const [autocomplete, setAutocomplete] = useState(false);
  const [selected, setSelected] = useState('');
  const [inviting, setInviting] = useState(false);
  return (
    <ScreenSizeProvider value={screenSize}>
      <main
        style={{
          padding: 16,
          minHeight: '100vh',
          background: color.Surface.Container,
          color: color.Surface.OnContainer,
        }}
      >
        <ModelPicker
          state={{
            eligible: true,
            runtimes: [],
            override: null,
            inherited: [],
            loading: false,
            pending: false,
            canMutate: true,
            models: Array.from({ length: 24 }, (_, index) => ({
              key: `model-${index + 1}`,
              id: `model-${index + 1}`,
              provider: 'Local',
              display_name: `Studio model ${String(index + 1).padStart(2, '0')}`,
            })),
            refresh: () => undefined,
            chooseRuntime: () => undefined,
            selectModel: setSelected,
            resetToRoomDefault: () => setSelected('default'),
          }}
        />
        <button type="button" onClick={() => setFilters(true)}>
          Open filters
        </button>
        <button type="button" onClick={() => setAutocomplete(true)}>
          Open autocomplete
        </button>
        <output>{selected}</output>
        <InviteAutocompleteMenu
          open={inviting}
          requestClose={() => setInviting(false)}
          menuId="studio-invites"
          menuLabel="People"
          headerContent={<Text>Invite people</Text>}
          input={
            <input
              aria-label="Invite search"
              onFocus={() => setInviting(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setInviting(false);
                }
              }}
            />
          }
        >
          {Array.from({ length: 20 }, (_, index) => (
            <button
              type="button"
              role="option"
              aria-selected={false}
              key={index}
              style={{ display: 'block', height: 44, width: '100%' }}
              onClick={() => {
                setSelected(`guest-${index + 1}`);
                setInviting(false);
              }}
            >
              Studio guest {index + 1}
            </button>
          ))}
        </InviteAutocompleteMenu>

        <FilterBarMobileSheet open={filters} requestClose={() => setFilters(false)}>
          {Array.from({ length: 20 }, (_, index) => (
            <button
              type="button"
              key={index}
              style={{ padding: 8 }}
              onClick={() => setSelected(`filter-${index + 1}`)}
            >
              Filter option {index + 1}
            </button>
          ))}
        </FilterBarMobileSheet>
        <div style={{ position: 'fixed', bottom: 40, insetInline: 20 }}>
          {autocomplete && (
            <AutocompleteMenu
              requestClose={() => setAutocomplete(false)}
              headerContent={<Text>Suggestions</Text>}
            >
              {Array.from({ length: 20 }, (_, index) => (
                <button
                  type="button"
                  key={index}
                  style={{ display: 'block', height: 40, width: '100%' }}
                  onClick={() => setSelected(`suggestion-${index + 1}`)}
                >
                  Suggestion {index + 1}
                </button>
              ))}
            </AutocompleteMenu>
          )}
        </div>
      </main>
    </ScreenSizeProvider>
  );
}
