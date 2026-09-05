const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, QUICK_ACTION_MENUS, NEXT_MENU_BY_ACTION } = require('../ai/intents/intent-map');

test('every quick-action menu entry references a registered action', () => {
  for (const [menuKey, items] of Object.entries(QUICK_ACTION_MENUS)) {
    for (const item of items) {
      assert.ok(ACTIONS[item.actionId], `${menuKey}.${item.key} -> ${item.actionId} is not a registered action`);
    }
  }
});

test('every NEXT_MENU_BY_ACTION entry points at a real action and a real menu', () => {
  for (const [actionId, menuKey] of Object.entries(NEXT_MENU_BY_ACTION)) {
    assert.ok(ACTIONS[actionId], `${actionId} is not a registered action`);
    assert.ok(QUICK_ACTION_MENUS[menuKey], `${menuKey} is not a registered menu`);
  }
});

test('mutating actions declare their required entities', () => {
  for (const [id, def] of Object.entries(ACTIONS)) {
    if (def.mutating) {
      assert.ok(def.requiresEntities.length > 0, `${id} is mutating but declares no required entities`);
    }
  }
});
