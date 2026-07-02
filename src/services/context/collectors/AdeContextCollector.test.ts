import { describe, expect, it } from "vitest";

import { buildUserProfileWire } from "./AdeContextCollector";

describe("buildUserProfileWire", () => {
  it("uses the active profile preset when selected", () => {
    const profile = buildUserProfileWire({
      "general.profileTechSavvy": "beginner",
      "general.profileJobRoles": ["Frontend Engineer"],
      "general.profileFamiliarTechStacks": ["React"],
      "general.profileDescription": "Default profile",
      "general.activeProfileId": "profile-data-science",
      "general.profilePresets": [
        {
          id: "profile-data-science",
          name: "Data Science",
          techSavvy: "expert",
          jobRoles: ["Data Scientist"],
          familiarTechStacks: ["Python", "SQL"],
          description: "Prefers statistical detail.",
        },
      ],
    });

    expect(profile).toEqual({
      name: "Data Science",
      techSavvy: "expert",
      jobRoles: ["Data Scientist"],
      familiarTechStacks: ["Python", "SQL"],
      description: "Prefers statistical detail.",
    });
  });
});
