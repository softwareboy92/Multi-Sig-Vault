import { useCallback } from 'react';
import { useLanguageStore } from '../stores/useLanguageStore';
import { translations } from '../i18n';

export const useTranslation = () => {
  const { language } = useLanguageStore();

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const keys = key.split('.');
      let value: any = translations[language] || translations['zh-CN'];

      for (const k of keys) {
        if (value && typeof value === 'object') {
          value = value[k];
        } else {
          if (language !== 'zh-CN') {
            let fallbackValue: any = translations['zh-CN'];
            for (const fk of keys) {
              if (fallbackValue && typeof fallbackValue === 'object') {
                fallbackValue = fallbackValue[fk];
              } else {
                return key;
              }
            }
            if (typeof fallbackValue === 'string') {
              value = fallbackValue;
              break;
            }
          }
          return key;
        }
      }

      if (typeof value === 'string') {
        if (params) {
          Object.entries(params).forEach(([k, v]) => {
            value = (value as string).replaceAll(`{${k}}`, String(v));
          });
        }
        return value;
      }

      return key;
    },
    [language]
  );

  return { t, language };
};
