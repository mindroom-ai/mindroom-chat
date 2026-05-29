import React, { ChangeEventHandler, KeyboardEventHandler, useEffect, useState } from 'react';
import { Input, toRem } from 'folds';
import { isKeyHotkey } from 'is-hotkey';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useSetting } from '../../state/hooks/settings';
import { MIN_PAGINATION_LIMIT, sanitizePaginationLimit } from '../threads/preloadSettings';
import { mindroomSettingsAtom } from './mindroomSettings';

type MindroomMessagePreloadLimitSettingProps = {
  className?: string;
};

export function MindroomMessagePreloadLimitSetting({
  className,
}: MindroomMessagePreloadLimitSettingProps) {
  return (
    <SequenceCard className={className} variant="SurfaceVariant" direction="Column">
      <SettingTile
        title="Message Preload Limit"
        description="Target number of history entries to preload for rooms and threads. The client fetches them in smaller batches under the hood. Minimum 50. Higher values use more memory."
        after={<MindroomMessagePreloadLimitInput />}
      />
    </SequenceCard>
  );
}

export function MindroomMessagePreloadLimitInput() {
  const [paginationLimit, setPaginationLimit] = useSetting(mindroomSettingsAtom, 'paginationLimit');
  const [currentLimit, setCurrentLimit] = useState(`${paginationLimit}`);

  useEffect(() => {
    setCurrentLimit(paginationLimit.toString());
  }, [paginationLimit]);

  const commitValue = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    const safe = sanitizePaginationLimit(parsed);
    setPaginationLimit(safe);
    setCurrentLimit(safe.toString());
  };

  const handleChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setCurrentLimit(evt.target.value);
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (evt) => {
    if (isKeyHotkey('escape', evt)) {
      evt.stopPropagation();
      setCurrentLimit(paginationLimit.toString());
    }
    if (
      isKeyHotkey('enter', evt) &&
      'value' in evt.target &&
      typeof evt.target.value === 'string'
    ) {
      commitValue(evt.target.value);
    }
  };

  const handleBlur = () => {
    commitValue(currentLimit);
  };

  return (
    <Input
      style={{ width: toRem(100) }}
      variant={paginationLimit === parseInt(currentLimit, 10) ? 'Secondary' : 'Success'}
      size="300"
      radii="300"
      type="number"
      min={MIN_PAGINATION_LIMIT.toString()}
      value={currentLimit}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      outlined
    />
  );
}
