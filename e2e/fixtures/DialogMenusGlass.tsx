import { useState } from 'react';
import { color, Icons, Text } from 'folds';
import { TriggerDivider } from '../../src/app/models/ModelPicker.css';
import { ComposerIconButton } from '../../src/app/composer/ComposerIconButton';
import { ModelPicker } from '../../src/app/models/ModelPicker';
import type { ModelCatalogEntry } from '../../src/app/models/modelProtocol';
import { ScreenSizeProvider, useScreenSize } from '../../src/app/lib/hooks/useScreenSize';
import { BottomSheet } from '../../src/app/ui/BottomSheet';
import { InviteAutocompleteMenu } from '../../src/app/members/invite/InviteAutocompleteMenu';
import { InviteAutocompleteOption } from '../../src/app/members/invite/InviteAutocompleteMenu.css';
import { AutocompleteMenu } from '../../src/app/editor/autocomplete/AutocompleteMenu';
import { ImagePackView } from '../../src/app/emoji/packs/ImagePackView';
import { TextViewer } from '../../src/app/messages/viewers/TextViewer';
import { Modal } from '../../src/app/ui/glass/GlassPrimitives';

/** The reasoning levels of the first models; the others have none. */
const FIXTURE_LEVELS: Array<Pick<ModelCatalogEntry, 'reasoning_levels' | 'reasoning_default'>> = [
  { reasoning_levels: ['low', 'medium', 'high', 'xhigh'], reasoning_default: 'high' },
  {
    reasoning_levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    reasoning_default: 'medium',
  },
];

/** Real menu components with deterministic data; no backend or external model calls. */
export function DialogMenusGlass() {
  const screenSize = useScreenSize();
  const [filters, setFilters] = useState(false);
  const [autocomplete, setAutocomplete] = useState(false);
  const [selected, setSelected] = useState('');
  const [inviting, setInviting] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const viewer = params.get('viewer');
  // `?logo=image` gives the models a custom icon; `?effort=0` runs a model without levels.
  const iconUrl = params.get('logo') === 'image' ? 'mxc://fixture/model-logo' : undefined;
  const effort = params.get('effort') !== '0';
  if (viewer) {
    return (
      <Modal
        style={{ position: 'fixed', inset: 16, width: 'auto', height: 'auto', maxWidth: 'none' }}
      >
        {viewer === 'pack' ? (
          <ImagePackView address={undefined} requestClose={() => {}} />
        ) : (
          <TextViewer
            name="notes.txt"
            text="Short file"
            langName="plaintext"
            requestClose={() => {}}
          />
        )}
      </Modal>
    );
  }
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
        {/* At the foot of the page, as in the composer, so its menu opens above it, with the
            composer's buttons after it. */}
        <div
          style={{
            position: 'fixed',
            insetBlockEnd: 16,
            insetInlineStart: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <ModelPicker
            state={{
              eligible: true,
              runtimes: [],
              override: null,
              reasoning: null,
              // The room default runs the first model at a level, so its button shows the bars.
              inherited: [
                effort
                  ? { entity: 'helper', model: 'model-1', reasoning: 'xhigh' }
                  : { entity: 'helper', model: 'model-3' },
              ],
              loading: false,
              pending: false,
              canMutate: true,
              models: Array.from({ length: 24 }, (_, index) => ({
                key: `model-${index + 1}`,
                id: `model-${index + 1}`,
                provider: 'Local',
                display_name: `Studio model ${String(index + 1).padStart(2, '0')}`,
                icon_url: iconUrl,
                ...(FIXTURE_LEVELS[index] ?? {}),
              })),
              refresh: () => undefined,
              chooseRuntime: () => undefined,
              selectModel: (key, level) => setSelected(level ? `${key}@${level}` : key),
              resetToRoomDefault: () => setSelected('default'),
            }}
          />
          <span className={TriggerDivider} aria-hidden="true" />
          <ComposerIconButton label="Attach" icon={Icons.PlusCircle} onPress={() => {}} />
          <ComposerIconButton label="Record voice" icon={Icons.Mic} onPress={() => {}} />
        </div>
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
              aria-selected={index === 0}
              className={InviteAutocompleteOption}
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

        {filters && (
          <BottomSheet
            title="Filters"
            closeLabel="Close filters"
            requestClose={() => setFilters(false)}
          >
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
          </BottomSheet>
        )}
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
