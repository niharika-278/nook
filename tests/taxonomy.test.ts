import { categoryKey, resolveCategoryCandidate, tagKey } from "../src/domain/taxonomy.js";

describe("balanced taxonomy normalization", () => {
  it("normalizes genuine portfolio synonyms without collapsing unrelated subjects", () => {
    expect(categoryKey(" Personal   Website ")).toBe("portfolio");
    expect(categoryKey("professional portfolio")).toBe("portfolio");
    expect(categoryKey("Career Development")).not.toBe(categoryKey("Career Tools"));
    expect(categoryKey("Engineering")).not.toBe(categoryKey("Software Engineering"));
  });

  it("reuses an existing category and preserves a narrower alias as a tag", () => {
    expect(resolveCategoryCandidate("personal portfolio", ["Portfolio", "Career"])).toEqual({
      name: "Portfolio",
      additionalTags: ["personal portfolio"],
    });
  });

  it("uses an existing parent only for an explicit hierarchy and keeps the detail as a tag", () => {
    expect(resolveCategoryCandidate("Programming: Python", ["Programming"])).toEqual({
      name: "Programming",
      additionalTags: ["Python"],
    });
    expect(resolveCategoryCandidate("Software Engineering", ["Engineering"])).toEqual({
      name: "Software Engineering",
      additionalTags: [],
    });
  });

  it("normalizes a small set of tag aliases but preserves unknown labels", () => {
    expect(tagKey("ReactJS")).toBe("react");
    expect(tagKey("React.js")).toBe("react");
    expect(tagKey("Interview Preparation")).toBe("interview preparation");
  });
});
