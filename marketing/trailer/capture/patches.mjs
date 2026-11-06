// [from, to] string replacements applied at build time to games/<g>/src/main.ts (never on disk).
// `globalThis.__TC_AUTO` lets each game's attract pilot keep playing during a real run, so the
// captured footage shows live HUDs, scores and play-mode effects.
const A = "(globalThis as any).__TC_AUTO";
export const patches = {
  __sdk: [
    // Hide the standalone dev HUD and let the capture harness set feed insets.
    ["doc.body.appendChild(hud);", 'hud.style.display = "none"; doc.body.appendChild(hud);'],
    [
      'const insets = (current: "preview" | "play"): InsetSet => ({ preview: ZERO, play: ZERO, current });',
      'const insets = (current: "preview" | "play"): InsetSet => ({ preview: (globalThis as any).__TC_INSETS?.preview ?? ZERO, play: (globalThis as any).__TC_INSETS?.play ?? ZERO, current });',
    ],
  ],
  duskrail: [['if (mode === "attract") pilot(speed);', `if (mode === "attract" || ${A}) pilot(speed);`]],
  flapjack: [
    ['    if (mode === "attract") {\n      const next = forks.find', `    if (mode === "attract" || ${A}) {\n      const next = forks.find`],
    ["if (p.y > target && p.vy > -60) flap(false);", 'if (p.y > target && p.vy > -60) flap(mode === "play");'],
  ],
  heatfall: [['if (mode === "attract") pilot(dt);', `if (mode === "attract" || ${A}) pilot(dt);`]],
  "neon-chop": [['if (mode === "attract") aiThink(rawDt);', `if (mode === "attract" || ${A}) aiThink(rawDt);`]],
  snek: [['if (mode === "attract") dir = pilot(', `if (mode === "attract" || ${A}) dir = pilot(`]],
  voltbrick: [['if (mode === "attract") aiThink(rawDt);', `if (mode === "attract" || ${A}) aiThink(rawDt);`]],
  stackd: [
    ['if (mode === "attract" && !over) {\n      aiTimer += dt;', `if ((mode === "attract" || ${A}) && !over) {\n      aiTimer += dt;`],
    ["aiError = (rng() - 0.5) * (rng.chance(0.3) ? 0.05 : 0.5);", `aiError = (rng() - 0.5) * (${A} && mode === "play" ? (rng.chance(0.7) ? 0.01 : 0.2) : rng.chance(0.3) ? 0.05 : 0.5);`],
  ],
  shortwick: [
    [
      '    if (mode === "attract") {\n      aiTimer -= dt;',
      `    if (mode === "play" && ${A} && !over) {\n      aiTimer -= dt;\n      if (aiTimer <= 0) {\n        aiTimer = 0.34 + rng.range(0, 0.16);\n        const d = bestMove(board.values());\n        if (d) doMove(d, true);\n      }\n    }\n    if (mode === "attract") {\n      aiTimer -= dt;`,
    ],
  ],
  kingsnare: [
    [
      '    } else if (session.phase === "playing" && !over) {\n      if (!busy) timeLeft -= dt;',
      `    } else if (session.phase === "playing" && !over) {\n      if (${A}) {\n        demoTimer -= dt;\n        if (demoTimer <= 0 && !busy && !chess.isCheckmate()) {\n          demoTimer = 0.55;\n          const u = puzzle.line[ply];\n          if (u) {\n            const from = u.slice(0, 2) as Square;\n            const m = chess.move({ from, to: u.slice(2, 4), promotion: u[4] });\n            squares.get(from)?.classList.add("sel");\n            animateMove(m);\n            ply++;\n            if (chess.isCheckmate()) solvedPuzzle();\n          }\n        }\n      }\n      if (!busy) timeLeft -= dt;`,
    ],
  ],
};
