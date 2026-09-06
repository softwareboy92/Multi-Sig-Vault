import { zhCN } from './translations/zh-CN';
import { en } from './translations/en';
import { ja } from './translations/ja';
import { ko } from './translations/ko';

type TranslationTree = Record<string, unknown>;

function deepMerge(base: TranslationTree, override: TranslationTree): TranslationTree {
  const result: TranslationTree = { ...base };
  Object.entries(override).forEach(([key, value]) => {
    const baseValue = result[key];
    result[key] =
      value && typeof value === 'object' && !Array.isArray(value) &&
      baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)
        ? deepMerge(baseValue as TranslationTree, value as TranslationTree)
        : value;
  });
  return result;
}

const traditionalCharacters: Record<string, string> = {
  '钱': '錢', '签': '簽', '账': '賬', '户': '戶', '体': '體', '录': '錄', '详': '詳',
  '细': '細', '设': '設', '网': '網', '络': '絡', '节': '節', '点': '點', '导': '導',
  '创': '創', '认': '認', '证': '證', '验': '驗', '态': '態', '发': '發', '额': '額',
  '时': '時', '间': '間', '历': '歷', '归': '歸', '档': '檔', '删': '刪', '启': '啟',
  '动': '動', '复': '複', '询': '詢', '统': '統', '计': '計', '显': '顯', '开': '開',
  '备': '備', '还': '還', '数': '數', '据': '據', '择': '擇', '项': '項', '虑': '慮',
  '错': '錯', '误': '誤', '载': '載', '败': '敗', '请': '請', '输': '輸', '连': '連',
  '检': '檢', '测': '測', '览': '覽', '获': '獲', '须': '須', '阈': '閾', '块': '塊',
  '链': '鏈', '储': '儲', '执': '執', '广': '廣', '暂': '暫', '拟': '擬', '毁': '毀',
  '险': '險', '级': '級', '过': '過', '滤': '濾', '仅': '僅', '与': '與', '为': '為',
  '无': '無', '对': '對', '应': '應', '类': '類', '从': '從', '这': '這', '个': '個',
  '们': '們', '将': '將', '进': '進', '处': '處', '预': '預', '顺': '順', '维': '維',
  '护': '護', '转': '轉', '换': '換', '总': '總', '务': '務', '实': '實', '权': '權',
};

function toTraditional(value: unknown): unknown {
  if (typeof value === 'string') {
    return [...value].map((char) => traditionalCharacters[char] || char).join('');
  }
  if (Array.isArray(value)) return value.map(toTraditional);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toTraditional(child)]));
  }
  return value;
}

export const translations: Record<string, any> = {
  'zh-CN': zhCN,
  'zh-TW': toTraditional(zhCN),
  en,
  ja: deepMerge(en, ja),
  ko: deepMerge(en, ko),
};

export type TranslationKey = typeof zhCN;
