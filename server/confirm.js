const memory = new Map();

function decide(key, currentValue, nextValue, max) {
  if (currentValue === nextValue) {
    memory.delete(key);
    return { apply: false, value: null, count: 0, max };
  }

  const old = memory.get(key) || { value: null, count: 0 };
  const count = old.value === nextValue ? old.count + 1 : 1;
  memory.set(key, { value: nextValue, count });

  if (count >= max) {
    memory.delete(key);
    return { apply: true, value: nextValue, count, max };
  }

  return { apply: false, value: nextValue, count, max };
}

module.exports = { decide };
