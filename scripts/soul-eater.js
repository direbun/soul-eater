const MODULE_ID = "soul-eater";
const TAB_ID = "soul-eater";
const TEMPLATE_PATH = `/modules/${MODULE_ID}/templates/soul-eater-tab.hbs`;
const ICON_PATH = `/modules/${MODULE_ID}/assets/soul.webp`;

// Path -> resonance max scaling
function getResMaxBase(path, level, prof) {
  const lvl = clamp(Math.floor(level), 1, 20);
  const pb = Math.max(0, Math.floor(prof));
  if (path === "balanced") return 2 * lvl + pb;
  if (path === "savant") return 3 * lvl + pb;
  // vanguard
  return lvl + pb;
}

// Path -> technique level cap
const PATH_TECH_MAX = {
  vanguard: 4,
  balanced: 5,
  savant: 9
};

// Weapon form help
const FORM_HELP = {
  polearm: {
    does: "Reach + sweeping control.",
    themes: "cones/lines, cleave, trip, keep-away, “momentum” stacks, battlefield zoning."
  },
  sword: {
    does: "Reliable all-rounder + duelist tools.",
    themes: "parry/riposte reactions, precision strikes, stance swaps, “mark” a target, crit-fishing tech."
  },
  heavy: {
    does: "Burst damage + “break guard.”",
    themes: "big single hits, knockback, stun/daZe-style effects, armor sunder, cleave that hits hard."
  },
  dual: {
    does: "Mobility + multi-hit pressure.",
    themes: "extra strikes, move-before/after attacks, bleed/poison-like riders, evasive reactions, finisher chains."
  },
  fist: {
    does: "Grapple + counters + “in your face.”",
    themes: "throws, restrains, interrupts, reaction blocks, combo strings that build to a finisher."
  },
  flexible: {
    does: "Control at mid-range + repositioning.",
    themes: "pull/push, disarm, entangle, “threat zone” effects, snagging enemies or yanking allies."
  },
  ranged: {
    does: "Safe damage + target manipulation.",
    themes: "trick shots, “mark and pop,” ricochets, piercing lines, special ammo modes, suppress/slow."
  },
  shield: {
    does: "Defense + protection + aggro tools.",
    themes: "reactions to reduce damage, protect allies, taunt/mark, barrier bursts, counter-bashes."
  },
  hybrid: {
    does: "Mode switching (melee ↔ ranged, light ↔ heavy, etc.).",
    themes: "“forms,” stance bars, technique discounts when swapping, adaptive resist/utility."
  }
};

Hooks.once("init", async () => {
  await loadTemplates([TEMPLATE_PATH]);
  if (!Handlebars.helpers.eq) Handlebars.registerHelper("eq", (a, b) => a === b);
  injectRuntimeCssOnce();
  patchGetRollData();
});

// Rest handling (short + long)
Hooks.on("dnd5e.restCompleted", async (actor, data) => {
  if (!actor) return;
  const restType = data?.restType ?? (data?.longRest ? "long" : data?.shortRest ? "short" : null);

  if (restType === "long") return await restoreResonanceLong(actor);
  if (restType === "short") return await restoreResonanceShort(actor);
});

Hooks.on("dnd5e.longRest", async (actor) => {
  if (actor) await restoreResonanceLong(actor);
});

Hooks.once("tidy5e-sheet.ready", (api) => {
  try {
    const HandlebarsTab = api?.models?.HandlebarsTab;
    const registerCharacterTab = api?.registerCharacterTab;
    if (!HandlebarsTab || !registerCharacterTab) return;

    registerCharacterTab(
      new HandlebarsTab({
        title: "Soul Eater",
        tabId: TAB_ID,
        iconClass: "dft-tab-icon",
        path: TEMPLATE_PATH,
        getData: async (context) => {
          const actor = context?.actor ?? context?.document ?? context?.app?.document;
          return buildTemplateData(actor);
        },
        onRender: (params) => {
          const rootEl = params?.tabContentsElement ?? params?.element;
          const actor = params?.app?.document ?? params?.app?.actor ?? params?.actor;
          wireTabInteractions(rootEl, actor);

          const sheetRoot = params?.app?.element?.[0] ?? params?.app?.element ?? document;
          hideSeItemsInSheet(sheetRoot, actor);
        }
      })
    );
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to register Tidy tab`, err);
  }
});

Hooks.on("renderActorSheetV2", async (sheet, element) => {
  try {
    if (!sheet?.actor || sheet.actor.type !== "character") return;

    // tidy handled above, but still hide managed items
    if (element?.classList?.contains("tidy5e-sheet")) {
      hideSeItemsInSheet(element, sheet.actor);
      return;
    }

    await injectCoreTab(sheet, element);
    hideSeItemsInSheet(element, sheet.actor);
  } catch (err) {
    console.error(`${MODULE_ID} | renderActorSheetV2 error`, err);
  }
});

async function injectCoreTab(sheet, element) {
  const nav =
    element.querySelector('nav.tabs[data-group]') ||
    element.querySelector('nav.sheet-tabs[data-group]') ||
    element.querySelector("nav.tabs") ||
    element.querySelector("nav.sheet-tabs") ||
    element.querySelector("nav[data-group]");
  if (!nav) return;

  const group = nav.dataset.group ?? "primary";

  const panel = findOrCreateCorePanel(element, group);
  await renderTabContents(panel, sheet.actor);
  wireTabInteractions(panel, sheet.actor);

  if (nav.querySelector(`[data-tab="${TAB_ID}"][data-group="${group}"]`)) return;

  const sample = nav.querySelector(":scope > *");
  const tabEl = document.createElement("button");
  if (sample?.className) tabEl.className = sample.className;
  tabEl.classList.add("item");
  tabEl.type = "button";
  tabEl.dataset.tab = TAB_ID;
  tabEl.dataset.group = group;
  tabEl.dataset.action = "tab";
  tabEl.title = "Soul Eater";

  tabEl.innerHTML = `
    <img class="dft-tab-icon-img" src="${ICON_PATH}" alt="" />
    <span class="dft-sr-only">Soul Eater</span>
  `;

  nav.appendChild(tabEl);

  if (!tabEl.dataset.dftBound) {
    tabEl.dataset.dftBound = "1";
    tabEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      if (typeof sheet.changeTab === "function") {
        sheet.changeTab(TAB_ID, group);
        return;
      }

      nav.querySelectorAll(`.item[data-group="${group}"]`).forEach((n) => {
        n.classList.toggle("active", n === tabEl);
        n.setAttribute("aria-selected", n === tabEl ? "true" : "false");
      });

      const contentRoot = panel.parentElement ?? element;
      contentRoot.querySelectorAll(`.tab[data-group="${group}"]`).forEach((p) => {
        const isActive = p.dataset.tab === TAB_ID;
        p.classList.toggle("active", isActive);
        p.style.display = isActive ? "" : "none";
      });
    });
  }
}

function findOrCreateCorePanel(element, group) {
  const existingPanel = element.querySelector(`.tab[data-group="${group}"]`);
  const contentRoot =
    existingPanel?.parentElement ||
    element.querySelector(".sheet-body") ||
    element.querySelector("section.sheet-body") ||
    element.querySelector(".window-content") ||
    element;

  let panel = contentRoot.querySelector(`.tab[data-tab="${TAB_ID}"][data-group="${group}"]`);
  if (!panel) {
    panel = document.createElement("section");
    panel.classList.add("tab");
    panel.dataset.tab = TAB_ID;
    panel.dataset.group = group;
    contentRoot.appendChild(panel);
  }
  return panel;
}

async function renderTabContents(panelEl, actor) {
  if (!panelEl || !actor) return;
  const data = buildTemplateData(actor);
  panelEl.innerHTML = await renderTemplate(TEMPLATE_PATH, data);
}

function isSeItem(item) {
  return Boolean(item?.getFlag?.(MODULE_ID, "seManaged") || item?.getFlag?.(MODULE_ID, "soulWeapon"));
}
function getSeItems(actor) {
  return (actor?.items?.contents ?? []).filter(isSeItem);
}

function buildTemplateData(actor) {
  const path = (actor.getFlag(MODULE_ID, "path") ?? "vanguard");
  const weaponName = (actor.getFlag(MODULE_ID, "weaponName") ?? "Soul Weapon");
  const weaponImg = (actor.getFlag(MODULE_ID, "weaponImg") ?? null);

  const weaponForm = (actor.getFlag(MODULE_ID, "weaponForm") ?? "polearm");
  const formHelp = FORM_HELP[weaponForm] ?? FORM_HELP.polearm;

  const bonusResonance = Number(actor.getFlag(MODULE_ID, "bonusResonance") ?? 0);

  const resonanceStat = (actor.getFlag(MODULE_ID, "resonanceStat") ?? "cha");
  const { saveDC, attackModSigned, abilityMod } = computeResonanceStats(actor, resonanceStat);

  const level = getActorLevel(actor);
  const prof = Number(actor?.system?.attributes?.prof ?? 0) || 0;

  const highestTechniqueLevel = getHighestTechniqueLevel(level, path);

  const resMaxBase = getResMaxBase(path, level, prof);
  const resMax = Math.max(0, resMaxBase + bonusResonance);

  const storedCurrent = actor.getFlag(MODULE_ID, "resCurrent");
  const resCurrentRaw = Number.isFinite(Number(storedCurrent)) ? Number(storedCurrent) : resMax;
  const resCurrent = clamp(resCurrentRaw, 0, resMax);
  const resPct = resMax > 0 ? (resCurrent / resMax) * 100 : 0;

// Weapon Level (1-20) + Death Scythe
const storedLevel = actor.getFlag(MODULE_ID, "weaponLevel");
const storedWeapon = actor.getFlag(MODULE_ID, "weapon") ?? {};
const rawLevel = Number.isFinite(Number(storedLevel)) ? Number(storedLevel) : Number(storedWeapon.level ?? 1);
const weaponLevel = clamp(Math.floor(rawLevel || 1), 1, 20);
const levelPct = (weaponLevel / 20) * 100;

const flaggedDeath = Boolean(actor.getFlag(MODULE_ID, "isDeathScythe"));
const isDeathScythe = flaggedDeath || weaponLevel >= 20;
const isGM = Boolean(game?.user?.isGM);

  
  const managed = getSeItems(actor).map((i) => ({
    uuid: i.uuid,
    id: i.id,
    name: i.name,
    img: i.img,
    type: i.type,
    resCost: Number(i.getFlag(MODULE_ID, "resCost") ?? 0),
    allowBoost: Boolean(i.getFlag(MODULE_ID, "allowBoost")),
    boostCost: Number(i.getFlag(MODULE_ID, "boostCost") ?? 0),
    spellLevel: Number(i.system?.level ?? i.system?.spellLevel ?? 0)
  }));

  const techniques = managed.filter((i) => i.type === "spell");
  const attacks = managed.filter((i) => i.type === "weapon");
  const features = managed.filter((i) => i.type === "feat");
  const other = managed.filter((i) => !["spell", "weapon", "feat"].includes(i.type));

  return {
    path,
    weaponName,
    weaponImg,

    weaponForm,
    formDoes: formHelp.does,
    formThemes: formHelp.themes,

    resonanceStat,
    saveDC,
    attackModSigned,
    highestTechniqueLevel,

    resCurrent,
    resMax,
    resPct: Math.round(resPct),
    bonusResonance,

    weaponLevel,
    levelPct: Math.round(levelPct),
    isDeathScythe,
    isGM,

    techniques,
    attacks,
    features,
    other,
    hasAny: managed.length > 0,

    _prof: prof,
    _abilityMod: abilityMod
  };
}

function wireTabInteractions(rootEl, actor) {
  if (!rootEl || !actor) return;

  // One-time auto-sync managed items to current resonance stat on first render
  if (!rootEl.dataset.dftAutosynced) {
    rootEl.dataset.dftAutosynced = "1";
    queueMicrotask(async () => {
      try {
        const desired = actor.getFlag(MODULE_ID, "resonanceStat") ?? "cha";
        const last = actor.getFlag(MODULE_ID, "lastAppliedResStat") ?? null;
        if (last !== desired) {
          await applyResStatToAllManagedItems(actor, desired);
          await actor.setFlag(MODULE_ID, "lastAppliedResStat", desired);
          rerenderAllActorSheets(actor);
        }
      } catch (e) {
        console.warn(`${MODULE_ID} | autosync failed`, e);
      }
    });
  }

  const pathSelect = rootEl.querySelector('[data-action="set-path"]');
  if (pathSelect && !pathSelect.dataset.dftWired) {
    pathSelect.dataset.dftWired = "1";
    pathSelect.addEventListener("change", async (ev) => {
      const next = ev.target?.value ?? "vanguard";
      await actor.setFlag(MODULE_ID, "path", next);

      await ensureResonanceBounds(actor);
      rerenderAllActorSheets(actor);
    });
  }

  const formSelect = rootEl.querySelector('[data-action="set-form"]');
  if (formSelect && !formSelect.dataset.dftWired) {
    formSelect.dataset.dftWired = "1";
    formSelect.addEventListener("change", async (ev) => {
      const next = ev.target?.value ?? "polearm";
      await actor.setFlag(MODULE_ID, "weaponForm", next);
      rerenderAllActorSheets(actor);
    });
  }

  const statSelect = rootEl.querySelector('[data-action="set-resonance-stat"]');
  if (statSelect && !statSelect.dataset.dftWired) {
    statSelect.dataset.dftWired = "1";
    statSelect.addEventListener("change", async (ev) => {
      const next = ev.target?.value ?? "cha";
      await actor.setFlag(MODULE_ID, "resonanceStat", next);

      await applyResStatToAllManagedItems(actor, next);
      await actor.setFlag(MODULE_ID, "lastAppliedResStat", next);

      rerenderAllActorSheets(actor);
    });
  }

  // Resonance controls
  const plusBtn = rootEl.querySelector('[data-action="res-plus"]');
  const minusBtn = rootEl.querySelector('[data-action="res-minus"]');
  const bonusBtn = rootEl.querySelector('[data-action="res-bonus"]');

  if (plusBtn && !plusBtn.dataset.dftWired) {
    plusBtn.dataset.dftWired = "1";
    plusBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await adjustResonance(actor, +1);
    });
  }
  if (minusBtn && !minusBtn.dataset.dftWired) {
    minusBtn.dataset.dftWired = "1";
    minusBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await adjustResonance(actor, -1);
    });
  }
  if (bonusBtn && !bonusBtn.dataset.dftWired) {
    bonusBtn.dataset.dftWired = "1";
    bonusBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const current = Number(actor.getFlag(MODULE_ID, "bonusResonance") ?? 0);
      const next = await promptBonusResonance(current);
      if (next === null) return;

      await actor.setFlag(MODULE_ID, "bonusResonance", next);
      await ensureResonanceBounds(actor);
      rerenderAllActorSheets(actor);
    });
  }
  // Weapon Level controls (GM only)
  const levelPlus = rootEl.querySelector('[data-action="level-plus"]');
  const levelMinus = rootEl.querySelector('[data-action="level-minus"]');

  if (levelPlus && !levelPlus.dataset.dftWired) {
    levelPlus.dataset.dftWired = "1";
    levelPlus.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await adjustWeaponLevel(actor, +1);
    });
  }
  if (levelMinus && !levelMinus.dataset.dftWired) {
    levelMinus.dataset.dftWired = "1";
    levelMinus.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await adjustWeaponLevel(actor, -1);
    });
  }

  // Item row actions
  if (!rootEl.dataset.dftClickBound) {
    rootEl.dataset.dftClickBound = "1";
    rootEl.addEventListener("click", async (ev) => {
      const action = ev.target?.closest("[data-action]")?.dataset?.action;
      if (!action) return;

      const li = ev.target.closest("[data-item-uuid]");
      const uuid = li?.dataset?.itemUuid;
      if (!uuid) return;

      const doc = await fromUuid(uuid).catch(() => null);
      const item = (doc?.documentName === "Item") ? doc : null;
      if (!item) return;

      if (action === "open") return item.sheet?.render(true);

      if (action === "edit") {
        const current = {
          resCost: Number(item.getFlag(MODULE_ID, "resCost") ?? 0),
          allowBoost: Boolean(item.getFlag(MODULE_ID, "allowBoost")),
          boostCost: Number(item.getFlag(MODULE_ID, "boostCost") ?? 0)
        };
        const updated = await promptItemResConfig(item, actor, current);
        if (!updated) return;

        await item.setFlag(MODULE_ID, "resCost", updated.resCost);
        await item.setFlag(MODULE_ID, "allowBoost", updated.allowBoost);
        await item.setFlag(MODULE_ID, "boostCost", updated.boostCost);

        rerenderAllActorSheets(actor);
        return;
      }

      if (action === "remove") {
        if (item.parent?.uuid === actor.uuid) {
          await item.delete();
          rerenderAllActorSheets(actor);
        }
        return;
      }

      if (action === "use") {
        await useSoulWeaponItem(actor, item);
        return;
      }
    });
  }

  // Drop handling
  if (!rootEl.dataset.dftDropBound) {
    rootEl.dataset.dftDropBound = "1";

    rootEl.addEventListener("dragover", (ev) => {
      const dropTarget = ev.target?.closest?.("[data-dft-drop]");
      if (!dropTarget) return;
      ev.preventDefault();
      ev.stopPropagation();
    }, { capture: true });

    rootEl.addEventListener("drop", async (ev) => {
      const dropTarget = ev.target?.closest?.("[data-dft-drop]");
      if (!dropTarget) return;

      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      const mode = dropTarget.dataset.dftDrop;
      if (mode === "weapon") return handleWeaponDrop(ev, actor);
      if (mode === "items") return handleItemDrop(ev, actor);
    }, { capture: true });
  }
}

async function handleWeaponDrop(event, actor) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can set the Soul Weapon image/name.");
    return;
  }

  const data = getDragEventDataSafe(event);
  if (!data?.uuid) return;

  const doc = await fromUuid(data.uuid).catch(() => null);
  if (!doc) return;

  if (doc.documentName !== "JournalEntryPage" || doc.type !== "image") {
    ui.notifications.warn("Drop an Image Journal Page (not a text page).");
    return;
  }

  const src = doc.src || doc.system?.src || doc.image?.src;
  if (!src) {
    ui.notifications.warn("That image page has no src.");
    return;
  }

  await actor.setFlag(MODULE_ID, "weaponImg", src);
  await actor.setFlag(MODULE_ID, "weaponName", doc.name ?? "Soul Weapon");
  rerenderAllActorSheets(actor);
}

async function handleItemDrop(event, actor) {
  const data = getDragEventDataSafe(event);
  if (!data || data.type !== "Item") return;

  const uuid = data.uuid ?? (data.pack && data.id ? `Compendium.${data.pack}.Item.${data.id}` : null);
  if (!uuid) return;

  const dropped = await fromUuid(uuid).catch(() => null);
  if (!dropped || dropped.documentName !== "Item") return;

  if (dropped.parent?.uuid === actor.uuid && isSeItem(dropped)) return;

  const createData = dropped.toObject();
  delete createData._id;

  createData.flags ??= {};
  createData.flags[MODULE_ID] = {
    ...(createData.flags[MODULE_ID] ?? {}),
    seManaged: true,
    soulWeapon: true,
    seSourceUuid: dropped.uuid
  };

  createData.flags.core ??= {};
  createData.flags.core.sourceId = dropped.uuid;

  const [created] = await actor.createEmbeddedDocuments("Item", [createData]);

  // Resonance config
  const cfg = await promptItemResConfig(created, actor, null);
  if (cfg) {
    await created.setFlag(MODULE_ID, "resCost", cfg.resCost);
    await created.setFlag(MODULE_ID, "allowBoost", cfg.allowBoost);
    await created.setFlag(MODULE_ID, "boostCost", cfg.boostCost);
  } else {
    await created.setFlag(MODULE_ID, "resCost", 1);
    await created.setFlag(MODULE_ID, "allowBoost", false);
    await created.setFlag(MODULE_ID, "boostCost", 1);
  }

  // AUTO APPLY formulas to activities
  const resonanceStat = actor.getFlag(MODULE_ID, "resonanceStat") ?? "cha";
  await applyResStatToItemActivities(created, resonanceStat);
  await actor.setFlag(MODULE_ID, "lastAppliedResStat", resonanceStat);

  rerenderAllActorSheets(actor);
  if (game.user.isGM) created.sheet?.render(true);
}

async function useSoulWeaponItem(actor, item) {
  let slotLevel = null;
  let totalCost = Number(item.getFlag(MODULE_ID, "resCost") ?? 0);

  const level = getActorLevel(actor);
  const path = actor.getFlag(MODULE_ID, "path") ?? "vanguard";
  const highestTechniqueLevel = getHighestTechniqueLevel(level, path);

  if (item.type === "spell") {
    const baseLevel = Number(item.system?.level ?? item.system?.spellLevel ?? 0);
    const allowBoost = Boolean(item.getFlag(MODULE_ID, "allowBoost"));
    const boostCost = Number(item.getFlag(MODULE_ID, "boostCost") ?? 0);

    if (allowBoost) {
      const chosen = await promptTechniqueCastLevel(item.name, baseLevel, highestTechniqueLevel);
      if (chosen === null) return;
      slotLevel = chosen;
      totalCost = totalCost + Math.max(0, (slotLevel - baseLevel)) * boostCost;
    } else {
      slotLevel = baseLevel;
    }
  }

  await ensureResonanceBounds(actor);
  const { resMax, resCurrent } = getResCurrentMax(actor);

  if (totalCost > resCurrent) {
    ui.notifications.warn(`Not enough resonance. Need ${totalCost}, have ${resCurrent}.`);
    return;
  }

  await actor.setFlag(MODULE_ID, "resCurrent", clamp(resCurrent - totalCost, 0, resMax));
  rerenderAllActorSheets(actor);

  try {
    const opts = { configureDialog: true, consumeSpellSlot: false, consumeSlot: false };
    if (slotLevel !== null) opts.slotLevel = slotLevel;
    await item.use(opts);
  } catch (e) {
    console.warn(`${MODULE_ID} | item.use failed, opening sheet instead`, e);
    item.sheet?.render(true);
  }
}

async function adjustResonance(actor, delta) {
  await ensureResonanceBounds(actor);
  const { resMax, resCurrent } = getResCurrentMax(actor);
  await actor.setFlag(MODULE_ID, "resCurrent", clamp(resCurrent + delta, 0, resMax));
  rerenderAllActorSheets(actor);
}

async function ensureResonanceBounds(actor) {
  const path = actor.getFlag(MODULE_ID, "path") ?? "vanguard";
  const bonus = Number(actor.getFlag(MODULE_ID, "bonusResonance") ?? 0);
  const level = getActorLevel(actor);
  const prof = Number(actor?.system?.attributes?.prof ?? 0) || 0;

  const max = Math.max(0, getResMaxBase(path, level, prof) + bonus);
  const stored = actor.getFlag(MODULE_ID, "resCurrent");
  const cur = Number.isFinite(Number(stored)) ? Number(stored) : max;

  await actor.setFlag(MODULE_ID, "resCurrent", clamp(cur, 0, max));
}

function getResCurrentMax(actor) {
  const path = actor.getFlag(MODULE_ID, "path") ?? "vanguard";
  const bonus = Number(actor.getFlag(MODULE_ID, "bonusResonance") ?? 0);
  const level = getActorLevel(actor);
  const prof = Number(actor?.system?.attributes?.prof ?? 0) || 0;

  const resMax = Math.max(0, getResMaxBase(path, level, prof) + bonus);
  const stored = actor.getFlag(MODULE_ID, "resCurrent");
  const resCurrent = clamp(Number.isFinite(Number(stored)) ? Number(stored) : resMax, 0, resMax);
  return { resMax, resCurrent };
}

async function restoreResonanceLong(actor) {
  await ensureResonanceBounds(actor);
  const { resMax } = getResCurrentMax(actor);
  await actor.setFlag(MODULE_ID, "resCurrent", resMax);
  rerenderAllActorSheets(actor);
}

async function restoreResonanceShort(actor) {
  await ensureResonanceBounds(actor);
  const path = actor.getFlag(MODULE_ID, "path") ?? "vanguard";
  const { resMax, resCurrent } = getResCurrentMax(actor);

  let regain = 0;

  if (path === "vanguard") {
    await actor.setFlag(MODULE_ID, "resCurrent", resMax);
    rerenderAllActorSheets(actor);
    return;
  }

  if (path === "balanced") {
    regain = Math.floor(resMax / 2);
  } else {
    const prof = Number(actor?.system?.attributes?.prof ?? 0) || 0;
    const stat = actor.getFlag(MODULE_ID, "resonanceStat") ?? "cha";
    const mod = Number(actor?.system?.abilities?.[stat]?.mod ?? 0) || 0;
    regain = Math.max(2, Math.floor(prof + mod));
  }

  await actor.setFlag(MODULE_ID, "resCurrent", clamp(resCurrent + regain, 0, resMax));
  rerenderAllActorSheets(actor);
}

async function adjustWeaponLevel(actor, delta) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can adjust weapon level.");
    return;
  }

  const stored = actor.getFlag(MODULE_ID, "weaponLevel");
  const weapon = actor.getFlag(MODULE_ID, "weapon") ?? {};
  const curRaw = Number.isFinite(Number(stored)) ? Number(stored) : Number(weapon.level ?? 1);
  const cur = clamp(Math.floor(curRaw || 1), 1, 20);

  const next = clamp(cur + Math.floor(delta || 0), 1, 20);

  // Persist in both a simple flag and a structured object for roll-data access
  await actor.setFlag(MODULE_ID, "weaponLevel", next);
  await actor.setFlag(MODULE_ID, "weapon", { ...weapon, level: next });

  // Transform at level 20
  if (next >= 20) {
    await actor.setFlag(MODULE_ID, "isDeathScythe", true);
    ui.notifications.info("The Soul Weapon has reached Level 20 — it becomes a Death Scythe!");
  } else {
    // Allow GM to downgrade if desired
    await actor.setFlag(MODULE_ID, "isDeathScythe", false);
  }

  rerenderAllActorSheets(actor);
}


// === Formulas (DC + Attack) ===
function getFormulasForStat(stat) {
  return {
    dcFormula: `10 + @prof + @abilities.${stat}.mod`,
    atkFormula: `@prof + @abilities.${stat}.mod`
  };
}

function listActivityIds(item) {
  const acts = item?.system?.activities;
  if (!acts) return [];
  if (typeof acts === "object") return Object.keys(acts);
  return [];
}

async function applyResStatToItemActivities(item, resonanceStat) {
  const { dcFormula, atkFormula } = getFormulasForStat(resonanceStat);
  const ids = listActivityIds(item);
  if (!ids.length) return;

  const update = {};

  for (const id of ids) {
    const base = `system.activities.${id}`;

    if (foundry.utils.hasProperty(item, `${base}.save.dc`)) {
      foundry.utils.setProperty(update, `${base}.save.dc.calculation`, "formula");
      foundry.utils.setProperty(update, `${base}.save.dc.formula`, dcFormula);
    }

    if (foundry.utils.hasProperty(item, `${base}.attack`)) {
      foundry.utils.setProperty(update, `${base}.attack.flat`, true);
      foundry.utils.setProperty(update, `${base}.attack.ability`, "none");
      foundry.utils.setProperty(update, `${base}.attack.bonus`, atkFormula);
    }
  }

  if (!Object.keys(update).length) return;

  try {
    await item.update(update);
  } catch (e) {
    console.warn(`${MODULE_ID} | Failed to apply resonance formulas to ${item.name}`, e, update);
  }
}

async function applyResStatToAllManagedItems(actor, resonanceStat) {
  const items = getSeItems(actor);
  for (const item of items) {
    await applyResStatToItemActivities(item, resonanceStat);
  }
}

function computeResonanceStats(actor, resonanceStat) {
  const prof = Number(actor?.system?.attributes?.prof ?? 0) || 0;
  const mod = Number(actor?.system?.abilities?.[resonanceStat]?.mod ?? 0) || 0;

  const saveDC = 10 + prof + mod;
  const attackMod = prof + mod;

  return {
    saveDC,
    attackModSigned: formatSigned(attackMod),
    abilityMod: mod
  };
}

// === Item config dialogs ===
function promptItemResConfig(item, actor, existing) {
  const isTechnique = item.type === "spell";

  const resCost = existing ? Number(existing.resCost ?? 0) : 1;
  const allowBoost = existing ? Boolean(existing.allowBoost) : false;
  const boostCost = existing ? Number(existing.boostCost ?? 0) : 1;

  const content = `
    <form class="dft-form">
      <div class="form-group">
        <label>How much resonance does this cost?</label>
        <input type="number" name="resCost" value="${resCost}" min="0" step="1"/>
      </div>

      ${isTechnique ? `
        <hr/>
        <div class="form-group">
          <label>
            <input type="checkbox" name="allowBoost" ${allowBoost ? "checked" : ""}/>
            Can this technique be boosted (cast at higher level)?
          </label>
        </div>
        <div class="form-group">
          <label>Boost cost (per level above base)</label>
          <input type="number" name="boostCost" value="${boostCost}" min="0" step="1"/>
        </div>
      ` : ``}
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: `Soul Weapon Cost: ${item.name}`,
      content,
      buttons: {
        ok: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: "Save",
          callback: (html) => {
            const form = html[0].querySelector("form");
            const cc = Number(form.resCost.value ?? 0);
            const au = isTechnique ? Boolean(form.allowBoost.checked) : false;
            const uc = isTechnique ? Number(form.boostCost.value ?? 0) : 0;
            resolve({
              resCost: Math.max(0, Math.floor(cc)),
              allowBoost: au,
              boostCost: Math.max(0, Math.floor(uc))
            });
          }
        },
        cancel: {
          icon: '<i class="fa-solid fa-xmark"></i>',
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

function promptTechniqueCastLevel(name, baseLevel, maxLevel) {
  const min = Math.max(0, baseLevel);
  const max = Math.max(min, maxLevel);
  if (min === 0) return Promise.resolve(0);

  const options = [];
  for (let lvl = min; lvl <= max; lvl++) options.push(`<option value="${lvl}">Level ${lvl}</option>`);

  const content = `
    <form class="dft-form">
      <div class="form-group">
        <label>Use "${name}" at what level?</label>
        <select name="slotLevel">${options.join("")}</select>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: "Technique Boost",
      content,
      buttons: {
        ok: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: "Use",
          callback: (html) => {
            const form = html[0].querySelector("form");
            resolve(Number(form.slotLevel.value));
          }
        },
        cancel: {
          icon: '<i class="fa-solid fa-xmark"></i>',
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

function promptBonusResonance(current) {
  const content = `
    <form class="dft-form">
      <div class="form-group">
        <label>Bonus resonance (can be negative)</label>
        <input type="number" name="bonus" value="${Number(current ?? 0)}" step="1"/>
      </div>
    </form>
  `;
  return new Promise((resolve) => {
    new Dialog({
      title: "Set Bonus Resonance",
      content,
      buttons: {
        ok: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: "Save",
          callback: (html) => {
            const form = html[0].querySelector("form");
            resolve(Math.floor(Number(form.bonus.value ?? 0)));
          }
        },
        cancel: {
          icon: '<i class="fa-solid fa-xmark"></i>',
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

// === Misc utils ===
function formatSigned(n) {
  const x = Number(n) || 0;
  return x >= 0 ? `+${x}` : `${x}`;
}

function hideSeItemsInSheet(sheetRoot, actor) {
  if (!sheetRoot || !actor) return;
  setTimeout(() => {
    const managedIds = getSeItems(actor).map((i) => i.id);
    if (!managedIds.length) return;

    for (const id of managedIds) {
      sheetRoot.querySelectorAll(`[data-item-id="${id}"]`).forEach((el) => el.classList.add("dft-hidden-item"));
      sheetRoot.querySelectorAll(`[data-document-id="${id}"]`).forEach((el) => el.classList.add("dft-hidden-item"));
      sheetRoot.querySelectorAll(`li[data-item-id="${id}"], li[data-document-id="${id}"]`)
        .forEach((el) => el.classList.add("dft-hidden-item"));
    }
  }, 0);
}

function getActorLevel(actor) {
  const direct = Number(actor.system?.details?.level);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const classes = actor.items?.filter?.((i) => i.type === "class") ?? [];
  const sum = classes.reduce((t, c) => t + Number(c.system?.levels ?? 0), 0);
  return sum > 0 ? sum : 1;
}

function getHighestTechniqueLevel(level, path) {
  const computed = Math.min(9, Math.floor((level + 1) / 2));
  const cap = PATH_TECH_MAX[path] ?? 9;
  return Math.min(cap, computed);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function rerenderAllActorSheets(actor) {
  try {
    const apps = actor?.apps ? Object.values(actor.apps) : [];
    for (const app of apps) app?.render?.(false);
    actor?.sheet?.render?.(false);
  } catch (err) {
    console.warn(`${MODULE_ID} | rerenderAllActorSheets failed`, err);
  }
}

function getDragEventDataSafe(event) {
  try {
    const v13 = foundry?.applications?.ux?.TextEditor?.getDragEventData;
    if (typeof v13 === "function") return v13(event);
  } catch (_) {}

  try {
    if (globalThis.TextEditor?.getDragEventData) return globalThis.TextEditor.getDragEventData(event);
  } catch (_) {}

  try {
    const raw = event?.dataTransfer?.getData("text/plain");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function patchGetRollData() {
  const cls = CONFIG?.Actor?.documentClass;
  const proto = cls?.prototype;
  const original = proto?.getRollData;
  if (typeof original !== "function") return;
  if (original._soulEaterPatched) return;

  proto.getRollData = function(...args) {
    const data = original.apply(this, args) ?? {};
    const flags = this.flags?.[MODULE_ID] ?? {};
    const weapon = flags.weapon ?? {};
    const levelRaw = Number.isFinite(Number(flags.weaponLevel)) ? Number(flags.weaponLevel) : Number(weapon.level ?? 1);
    const level = clamp(Math.floor(levelRaw || 1), 1, 20);

    const payload = { weapon: { level, isDeathScythe: Boolean(flags.isDeathScythe) || level >= 20 } };

    // Primary requested path:
    data["soul-eater"] = payload;

    // Extra aliases (handy if a module/formula parser chokes on hyphens):
    data.soulEater = payload;
    data.soul_eater = payload;

    return data;
  };

  proto.getRollData._soulEaterPatched = true;
}

function injectRuntimeCssOnce() {
  if (document.getElementById("dft-runtime-style")) return;
  const style = document.createElement("style");
  style.id = "dft-runtime-style";
  style.textContent = `
    .dft-hidden-item { display: none !important; }
    .dft-tab-icon-img { width: 18px; height: 18px; object-fit: contain; vertical-align: middle; }
    .dft-sr-only {
      position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
      clip:rect(0,0,0,0);white-space:nowrap;border:0;
    }
    .dft-tab-icon::before {
      content: "";
      display: inline-block;
      width: 1em;
      height: 1em;
      background-image: url("${ICON_PATH}");
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      vertical-align: middle;
    }
  `;
  document.head.appendChild(style);
}
