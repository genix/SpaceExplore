// Visualises a revealed resource deposit on the map. Created by the Scanner
// module when a deposit is uncovered (or by DepositGen on planets that allow
// pre-revealed deposits in the future). Not carryable; not impassable; the
// player walks onto it and drops an Auto-Drill to begin extraction.
const DepositObject = (() => {

  function create(id, x, y, resource) {
    const color = ResourceItems.getColor(resource);
    const code  = ResourceItems.getCode(resource);
    return {
      id, type: 'deposit',
      x, y,
      passable: true,
      carryable: false,
      interactable: false,
      depositId: id,
      resource,
      footprint: [{ dx: 0, dy: 0 }],
      glyphs: {
        '0,0': { chars: [code, '··'], color },
      },
    };
  }

  return { create };
})();
