import { describe, expect, it } from "vitest";
import { copyrightLine, decode, detectLicense, encode, fillTemplate, homepageOf, licenseIds, normalizeText, type Notice } from "../licenses/collect.ts";

const MIT_TEMPLATE = "MIT License\n\nCopyright (c) <year> <copyright holders>\n\nPermission is hereby granted, free of charge, to any person";

describe("copyright lines", () => {
  it("finds notices in comments, READMEs and markdown", () => {
    expect(copyrightLine(" * Copyright (c) Meta Platforms, Inc. and affiliates.")).toBe("Copyright (c) Meta Platforms, Inc. and affiliates.");
    expect(copyrightLine("// Copyright 2014 The Chromium Authors. All rights reserved.")).toBe("Copyright 2014 The Chromium Authors. All rights reserved.");
    expect(copyrightLine("**Copyright © 2012 Near Infinity Corporation**")).toBe("Copyright © 2012 Near Infinity Corporation");
    expect(copyrightLine("/*! Copyright (c) 2020 Jane Doe */")).toBe("Copyright (c) 2020 Jane Doe");
  });

  it("ignores licence wording, templates and code that mentions copyright", () => {
    expect(copyrightLine("The above copyright notice and this permission notice shall be")).toBeNull();
    expect(copyrightLine("copyright holders be liable for any claim")).toBeNull();
    expect(copyrightLine("Copyright (c) <year> <copyright holders>")).toBeNull();
    expect(copyrightLine("return `# Copyright (c) Meta Platforms, Inc.`;")).toBeNull();
    expect(copyrightLine("Copyright (c)")).toBeNull();
  });
});

describe("standard texts", () => {
  it("replace the template's copyright line, or drop it when none is known", () => {
    expect(fillTemplate(MIT_TEMPLATE, "replace", ["Copyright (c) Meta Platforms, Inc. and affiliates."])).toBe(
      "MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates.\n\nPermission is hereby granted, free of charge, to any person",
    );
    expect(fillTemplate(MIT_TEMPLATE, "replace", [])).toBe("MIT License\n\nPermission is hereby granted, free of charge, to any person");
    expect(fillTemplate("Apache License\nVersion 2.0", "prepend", ["Copyright 2020 Google LLC"])).toBe("Copyright 2020 Google LLC\n\nApache License\nVersion 2.0");
    expect(fillTemplate("This is free and unencumbered software", "omit", ["Copyright (c) Someone"])).toBe("This is free and unencumbered software");
  });

  it("apply every part of an AND and the first usable option of an OR", () => {
    expect(licenseIds("MIT")).toEqual(["MIT"]);
    expect(licenseIds("(MIT OR Apache-2.0)")).toEqual(["MIT"]);
    expect(licenseIds("(BSD-3-Clause OR GPL-2.0)")).toEqual(["BSD-3-Clause"]);
    expect(licenseIds("(GPL-2.0 OR MIT)")).toEqual(["MIT"]);
    expect(licenseIds("MIT AND Apache-2.0")).toEqual(["MIT", "Apache-2.0"]);
  });

  it("recognise licences from their wording", () => {
    expect(detectLicense("Permission is hereby granted, free of\ncharge, to any person")).toBe("MIT");
    expect(detectLicense("Apache License\nVersion 2.0, January 2004")).toBe("Apache-2.0");
    expect(detectLicense("Redistribution and use in source and binary forms ... Neither the name of")).toBe("BSD-3-Clause");
    expect(detectLicense("All rights reserved.")).toBeNull();
  });
});

describe("texts", () => {
  it("normalise line endings and surrounding whitespace only", () => {
    expect(normalizeText("\uFEFF\n\nMIT License  \r\n\r\nCopyright (c) A\r\n\n")).toBe("MIT License\n\nCopyright (c) A");
  });

  it("are stored once, split into shared paragraphs, and decode byte-exact", () => {
    const body = "Permission is hereby granted.\n\nTHE SOFTWARE IS PROVIDED AS IS.";
    const notice = (name: string, text: string): Notice => ({ name, version: "1.0.0", license: "MIT", kind: "package", files: [{ name: "LICENSE", text }] });
    const texts = [`Copyright (c) A\n\n${body}`, `Copyright (c) B\n\n${body}`, `Copyright (c) A\n\n${body}`, "Odd\n\n\nspacing\n\n"];
    const { rows, paragraphs, texts: stored } = encode(texts.map((t, i) => notice(`p${i}`, t)));
    expect(stored).toHaveLength(3);
    expect(rows[0]!.files[0]!.text).toBe(rows[2]!.files[0]!.text);
    expect(paragraphs.filter((p) => p === "Permission is hereby granted.")).toHaveLength(1);
    rows.forEach((r, i) => expect(decode(paragraphs, stored, r.files[0]!.text)).toBe(texts[i]));
  });
});

it("links to https homepages and repositories", () => {
  expect(homepageOf({ homepage: "https://react.dev/" })).toBe("https://react.dev/");
  expect(homepageOf({ repository: { url: "git+https://github.com/facebook/react.git" } })).toBe("https://github.com/facebook/react");
  expect(homepageOf({ repository: { url: "git+ssh://git@github.com/react/react-native.git" } })).toBe("https://github.com/react/react-native");
  expect(homepageOf({ repository: "nuxt-community/jimp-compact" })).toBe("https://github.com/nuxt-community/jimp-compact");
  expect(homepageOf({ homepage: "https://github.com/babel/babel#readme" })).toBe("https://github.com/babel/babel");
  expect(homepageOf({})).toBeUndefined();
});
