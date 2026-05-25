// LexoRank-подобные строковые ключи для сортировки kanban-карточек.
//
// Поддерживаем тот же базовый алфавит, что и Atlassian LexoRank в самом
// типичном случае: цифры '0'..'9' и буквы 'a'..'z'. Это даёт 36-символьную
// систему счисления и совпадает с jira-рангами вида '0|i00007:'.
//
// Контракт:
//   - rankBetween(prev, next) возвращает rank, строго между prev и next по
//     лексикографическому сравнению. Если оба параметра null/undefined —
//     возвращает середину пространства ('i'). Если prev=null — берём rank
//     левее next. Если next=null — правее prev.
//   - rankBefore(r) / rankAfter(r) — частные случаи rankBetween.
//   - rank возвращаемой строки всегда оканчивается на не-минимальный символ,
//     чтобы между ним и его соседом всегда можно было вставить новый rank.
//
// Внутреннее устройство не сохраняет совместимость с LexoRank-bucket'ами
// (Atlassian-овский префикс '0|...'); мы не пытаемся писать в их таблицу —
// фактический ranking custom field принимает любую отсортированную строку.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const RADIX = ALPHABET.length
const MIN_CHAR = ALPHABET[0]!
const MAX_CHAR = ALPHABET[RADIX - 1]!
const MID_CHAR = ALPHABET[Math.floor(RADIX / 2)]!

function indexOf(ch: string): number {
  const i = ALPHABET.indexOf(ch)
  if (i < 0) throw new Error(`rank: unexpected character ${JSON.stringify(ch)}`)
  return i
}

function isValid(rank: string): boolean {
  if (!rank) return false
  for (let i = 0; i < rank.length; i += 1) {
    if (ALPHABET.indexOf(rank[i]!) < 0) return false
  }
  return true
}

// Нормализуем rank так, чтобы он не оканчивался на минимальный символ.
// Это инвариант, делающий rankBefore безопасным.
function trim(rank: string): string {
  let end = rank.length
  while (end > 1 && rank[end - 1] === MIN_CHAR) end -= 1
  return rank.slice(0, end)
}

export function rankBetween(prev: string | null | undefined, next: string | null | undefined): string {
  const a = prev && isValid(prev) ? prev : null
  const b = next && isValid(next) ? next : null

  if (a && b && a >= b) {
    // Невалидная пара — после оптимистики UI может прислать prev>=next.
    // Возвращаем rank правее prev, как при вставке в конец.
    return rankAfter(a)
  }
  if (!a && !b) return MID_CHAR
  if (!a) return rankBefore(b!)
  if (!b) return rankAfter(a)

  // Идём посимвольно, набирая общий префикс. Как только нашли позицию,
  // где a[i] < b[i], пытаемся вставить символ между ними; если разница в
  // соседних символах — расширяем строку.
  let i = 0
  let common = ''
  while (true) {
    const ai = i < a.length ? indexOf(a[i]!) : 0
    const bi = i < b.length ? indexOf(b[i]!) : RADIX
    if (ai === bi) {
      common += ALPHABET[ai]!
      i += 1
      continue
    }
    if (bi - ai > 1) {
      const mid = Math.floor((ai + bi) / 2)
      return trim(common + ALPHABET[mid]!)
    }
    // Символы соседние: фиксируем a[i], дальше работаем правее.
    common += ALPHABET[ai]!
    i += 1
    // Ищем первую "дырку" в продолжении a.
    while (true) {
      const aj = i < a.length ? indexOf(a[i]!) : 0
      if (aj < RADIX - 1) {
        const mid = Math.floor((aj + RADIX) / 2)
        return trim(common + ALPHABET[mid]!)
      }
      common += ALPHABET[aj]!
      i += 1
      if (i > a.length + 16) {
        // Защита от патологии: длинные хвосты MAX_CHAR. Добавим середину
        // алфавита и вернём — это гарантированно > a и < b.
        return trim(common + MID_CHAR)
      }
    }
  }
}

export function rankBefore(rank: string): string {
  if (!isValid(rank)) return MID_CHAR
  // Берём первый символ слева, пытаемся уменьшить. Если он уже '0' —
  // удлиняем хвостом MID, что лексикографически меньше.
  const head = indexOf(rank[0]!)
  if (head > 0) {
    const mid = Math.floor(head / 2)
    if (mid !== head) return trim(ALPHABET[mid]!)
  }
  // rank начинается с '0' (или с символа, у которого нет места слева):
  // добавляем точку посередине, чтобы получить rank < rank.
  // '0' < '00m' < '0a' — нам подходит вариант head + длинный хвост.
  return trim(rank[0]! + MIN_CHAR + MID_CHAR)
}

export function rankAfter(rank: string): string {
  if (!isValid(rank)) return MID_CHAR
  const head = indexOf(rank[0]!)
  if (head < RADIX - 1) {
    const mid = Math.floor((head + RADIX) / 2)
    if (mid !== head) return trim(ALPHABET[mid]!)
  }
  // Уже на максимальном символе — удлиняем строку, чтобы получить rank > rank.
  return trim(rank + MID_CHAR)
}

// Генерирует n равномерно распределённых rank-ов между prev и next.
// Полезно для /api/issues/batch-rank, когда несколько карточек одновременно
// вставляются в одно место.
export function rankSequence(
  prev: string | null,
  next: string | null,
  n: number,
): string[] {
  if (n <= 0) return []
  const result: string[] = []
  let left = prev
  for (let i = 0; i < n; i += 1) {
    const r = rankBetween(left, next)
    result.push(r)
    left = r
  }
  return result
}

export const __test = { ALPHABET, RADIX, MIN_CHAR, MAX_CHAR, MID_CHAR, isValid, trim }
