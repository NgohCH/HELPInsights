import { createRoot } from "react-dom/client";
import { Creator } from "./creator.tsx";
import { Operations } from "./operations.tsx";
import { ToolSettings } from "./tool-settings.tsx";
import { LiveQuiz } from "./live-quiz.tsx";
import { Respondent } from "./respondent.tsx";

const target = document.getElementById("app");
if (!target) throw new Error("Application root missing");

const token = /^\/respond\/([A-Za-z0-9_-]{43})$/.exec(location.pathname)?.[1];
const root = createRoot(target);
const signInOptions = {
  universitySignIn: target.dataset.universitySignIn === "true",
  developmentSignIn: target.dataset.developmentSignIn !== "false",
};
if (token) root.render(<Respondent token={token} />);
else if (location.pathname === "/admin/settings")
  root.render(
    <ToolSettings universitySignIn={signInOptions.universitySignIn} />,
  );
else if (location.pathname === "/admin")
  root.render(<Operations {...signInOptions} />);
else if (
  location.pathname === "/live/host" ||
  location.pathname === "/live/game-host" ||
  location.pathname === "/live/join"
)
  root.render(
    <LiveQuiz
      isHost={location.pathname !== "/live/join"}
      gameShow={location.pathname === "/live/game-host"}
    />,
  );
else root.render(<Creator {...signInOptions} />);
