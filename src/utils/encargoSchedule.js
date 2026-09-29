const TIME_ZONE = 'America/Mexico_City';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  weekday: 'short'
});

function localParts(value) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(value))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    weekday: parts.weekday
  };
}

function localDateKey(value) {
  const parts = localParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function timezoneOffsetMs(value) {
  const parts = localParts(value);
  const representedAsUtc = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second
  );
  return representedAsUtc - new Date(value).getTime();
}

function localDateAtHour(value, hour) {
  const parts = localParts(value);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour);
  let instant = new Date(localAsUtc);
  // Recalcular permite respetar cambios históricos o futuros del huso horario.
  for (let i = 0; i < 2; i += 1) {
    instant = new Date(localAsUtc - timezoneOffsetMs(instant));
  }
  return instant;
}

function puedeCrearEncargo(ahora = new Date()) {
  return localParts(ahora).hour < 22;
}

function puedeCancelarEncargo(createdAt, ahora = new Date()) {
  if (!createdAt || Number.isNaN(new Date(createdAt).getTime())) return false;
  return localDateKey(createdAt) === localDateKey(ahora) && localParts(ahora).hour < 21;
}

function cancelableHasta(createdAt) {
  return localDateAtHour(createdAt, 21);
}

function fechaEstimadaLlegada(createdAt) {
  const parts = localParts(createdAt);
  const days = parts.weekday === 'Sat' ? 2 : 1;
  const result = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return [result.getUTCFullYear(), String(result.getUTCMonth() + 1).padStart(2, '0'),
    String(result.getUTCDate()).padStart(2, '0')].join('-');
}

module.exports = {
  TIME_ZONE,
  puedeCrearEncargo,
  puedeCancelarEncargo,
  cancelableHasta,
  fechaEstimadaLlegada
};
