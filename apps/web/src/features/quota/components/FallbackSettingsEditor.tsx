import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  validFallbackSettings,
  type ClaudeFallbackSettings,
} from '@/features/personal-quota-support/services/api/claudeFallback';
import { Select } from './Select';
import styles from './QuotaSettingsToolbar.module.scss';

/** The Claude -> Codex mode and model mappings, without the enable toggle. */
export type FallbackModeMappingsValue = Pick<ClaudeFallbackSettings, 'mode' | 'mappings'>;

/**
 * Controlled editor for the fallback mode and the model-mapping table. The provider
 * routing block shows it for the Codex target; `FallbackSettingsEditor` adds the toggle.
 * While `enabled` (the default) the table must hold at least one valid mapping.
 */
export function FallbackModeMappings({
  value,
  enabled = true,
  models,
  disabled,
  onChange,
}: {
  value: FallbackModeMappingsValue;
  enabled?: boolean;
  models: { claude: string[]; codex: string[] };
  disabled: boolean;
  onChange: (value: FallbackModeMappingsValue) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const setMappings = (mappings: ClaudeFallbackSettings['mappings']) =>
    onChange({ mode: value.mode, mappings });
  const updateRow = (index: number, patch: Partial<{ from: string; to: string }>) =>
    setMappings(value.mappings.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  return (
    <>
      <Select
        value={value.mode}
        disabled={disabled}
        ariaLabel={t('quota_management.fallback.mode')}
        options={[
          { value: 'auto', label: t('quota_management.fallback.auto') },
          { value: 'always', label: t('quota_management.fallback.always') },
        ]}
        onChange={(mode) =>
          onChange({ mode: mode as ClaudeFallbackSettings['mode'], mappings: value.mappings })
        }
      />
      <p>{t(`quota_management.fallback.${value.mode}_hint`)}</p>
      <p>{t('quota_management.fallback.mapping_hint')}</p>
      <datalist id={`${id}-claude`}>
        {models.claude.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <datalist id={`${id}-codex`}>
        {models.codex.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      {value.mappings.map((row, index) => (
        <div className={styles.fallbackRow} key={index}>
          <input
            className="input"
            list={`${id}-claude`}
            value={row.from}
            disabled={disabled}
            aria-label={t('quota_management.fallback.source', { index: index + 1 })}
            placeholder="claude-opus-*"
            onChange={(event) => updateRow(index, { from: event.target.value })}
          />
          <span aria-hidden="true">→</span>
          <input
            className="input"
            list={`${id}-codex`}
            value={row.to}
            disabled={disabled}
            aria-label={t('quota_management.fallback.target', { index: index + 1 })}
            placeholder="gpt-6-astra"
            onChange={(event) => updateRow(index, { to: event.target.value })}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            aria-label={t('quota_management.fallback.remove', { index: index + 1 })}
            onClick={() => setMappings(value.mappings.filter((_, i) => i !== index))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => setMappings([...value.mappings, { from: '', to: '' }])}
      >
        {t('quota_management.fallback.add')}
      </Button>
      {!validFallbackSettings({ enabled, mode: value.mode, mappings: value.mappings }) && (
        <p role="alert" className={styles.fieldError}>
          {t('quota_management.fallback.invalid')}
        </p>
      )}
    </>
  );
}

/**
 * Controlled editor for one Claude -> Codex fallback block: the enabled toggle, the mode,
 * and the model mappings. Used by the shared fallback modal on a backend without
 * per-provider routing.
 */
export function FallbackSettingsEditor({
  value,
  models,
  disabled,
  onChange,
  children,
}: {
  value: ClaudeFallbackSettings;
  models: { claude: string[]; codex: string[] };
  disabled: boolean;
  onChange: (value: ClaudeFallbackSettings) => void;
  /** Extra content rendered at the end of the editor, such as a save error. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.fallbackEditor}>
      <ToggleSwitch
        checked={value.enabled}
        disabled={disabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
        label={t('quota_management.fallback.title')}
      />
      <FallbackModeMappings
        value={value}
        enabled={value.enabled}
        models={models}
        disabled={disabled}
        onChange={(part) => onChange({ ...value, ...part })}
      />
      {children}
    </div>
  );
}
