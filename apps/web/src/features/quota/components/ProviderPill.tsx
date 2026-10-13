import { useTranslation } from 'react-i18next';
import { getTypeColor, getTypeLabel } from '@/features/quota/authFiles/constants';
import type { ResolvedTheme } from '@/features/personal-quota-support/types';
import styles from './ProviderPill.module.scss';

/** Provider badge in the Auth Files card style (same colors as AuthFileCard). */
export function ProviderPill({
  type,
  resolvedTheme,
}: {
  type: string;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const color = getTypeColor(type, resolvedTheme);
  return (
    <span
      className={styles.pill}
      data-provider={type}
      style={{
        backgroundColor: color.bg,
        color: color.text,
        ...(color.border ? { border: color.border } : {}),
      }}
    >
      {getTypeLabel(t, type)}
    </span>
  );
}
