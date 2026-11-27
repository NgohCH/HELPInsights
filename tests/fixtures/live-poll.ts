import assert from "node:assert/strict";
import { definition } from "./survey.ts";
import { liveQuizFixture } from "./live-quiz.ts";

const first = definition.pages[0].questions[0];
export const pollDefinition = {
  ...definition,
  pages: [
    {
      ...definition.pages[0],
      questions: [
        first,
        {
          ...first,
          id: "venue",
          code: "workshop_venue",
          title: "Which room should we use?",
        },
      ],
    },
  ],
};

export async function livePollFixture() {
  const setup = await liveQuizFixture(pollDefinition);
  const { api, owner, quizVersionId } = setup;
  const response = await api(
    "/live-sessions",
    "POST",
    { quizVersionId, mode: "live_poll" },
    owner,
  );
  assert.equal(response.status, 201);
  const { id, pin } = await response.json();
  const path = "/live-sessions/" + id;
  async function join() {
    const admitted = await api("/live-sessions/join", "POST", { pin });
    assert.equal(admitted.status, 200);
    return ("Participant " +
      (await admitted.json()).participantToken) as string;
  }
  function command(command: string, revision: number) {
    return api(
      path + "/commands",
      "POST",
      { command, expectedRevision: String(revision) },
      owner,
    );
  }
  return { ...setup, id, pin, path, join, command };
}
