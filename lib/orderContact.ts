/**
 * Контакт на приёмке: телефон и имя часто пишут в комментарии заявки
 * (напр. «вывоз 12ой +79532799112 Евгений»). Если в комментарии номера нет —
 * берём телефон из поля заявки.
 */

import { formatPhoneDisplay } from '@/lib/phone';

const PHONE_RE = /(?:\+?[78][\s\-()]*)?\d(?:[\s\-()]*\d){9,10}/g;
/** 1–3 слова рядом с телефоном — кандидат на имя. */
const NAME_CHUNK_RE =
  /[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’\-]{1,30}(?:\s+[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’\-]{1,30}){0,2}/;
const NOISE_NAME_RE =
  /^(тел|телефон|контакт|вотсап|whatsapp|viber|telegram|tg|звон|набрать|приемка|приёмка|объект|адрес|выезд|вывоз|микс|миксер|бетон|раствор)$/i;

export type PhoneMatch = {
  raw: string;
  index: number;
  length: number;
};

export function extractPhoneFromText(text?: string | null): PhoneMatch | null {
  if (!text) return null;
  const re = new RegExp(PHONE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
      return { raw: m[0].trim(), index: m.index, length: m[0].length };
    }
    if (digits.length === 10 && digits[0] === '9') {
      return { raw: m[0].trim(), index: m.index, length: m[0].length };
    }
  }
  return null;
}

function isNoiseName(name: string): boolean {
  const parts = name.trim().split(/\s+/);
  return parts.every((p) => NOISE_NAME_RE.test(p));
}

/** Имя рядом с найденным телефоном (после или перед номером). */
export function extractContactNameNearPhone(
  text: string | null | undefined,
  phone: PhoneMatch,
): string | null {
  if (!text) return null;

  const after = text.slice(phone.index + phone.length);
  const afterMatch = after.match(
    new RegExp(`^\\s*[,.:;–—\\-]?\\s*(${NAME_CHUNK_RE.source})`),
  );
  if (afterMatch?.[1] && !isNoiseName(afterMatch[1])) {
    return afterMatch[1].trim();
  }

  const before = text.slice(0, phone.index);
  const beforeMatch = before.match(
    new RegExp(`(${NAME_CHUNK_RE.source})\\s*[,.:;–—\\-]?\\s*$`),
  );
  if (beforeMatch?.[1] && !isNoiseName(beforeMatch[1])) {
    return beforeMatch[1].trim();
  }

  return null;
}

export type OrderReceivingContact = {
  phone: string | null;
  /** Отображаемый телефон (+7 …) или null */
  phoneDisplay: string | null;
  name: string | null;
  /** Телефон взят из комментария (а не из поля заявки) */
  fromComment: boolean;
};

export function resolveOrderReceivingContact(order?: {
  phone?: string | null;
  comment?: string | null;
} | null): OrderReceivingContact {
  if (!order) {
    return { phone: null, phoneDisplay: null, name: null, fromComment: false };
  }

  const fromComment = extractPhoneFromText(order.comment);
  const rawPhone = fromComment?.raw || order.phone || null;
  const name = fromComment
    ? extractContactNameNearPhone(order.comment, fromComment)
    : null;
  const phoneDisplay =
    rawPhone && formatPhoneDisplay(rawPhone) !== '—'
      ? formatPhoneDisplay(rawPhone)
      : rawPhone
        ? String(rawPhone).trim()
        : null;

  return {
    phone: rawPhone ? String(rawPhone).trim() : null,
    phoneDisplay,
    name: name || null,
    fromComment: !!fromComment,
  };
}
