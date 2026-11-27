import { createRoot } from "react-dom/client";
import { Creator } from "./creator.tsx";
import { LiveQuiz } from "./live-quiz.tsx";
import { Respondent } from "./respondent.tsx";

const target = document.getElementById("app");
if (!target) throw new Error("Application root missing");

const token = /^\/respond\/([A-Za-z0-9_-]{43})$/.exec(location.pathname)?.[1];
const root = createRoot(target);
if (token) root.render(<Respondent token={token} />);
else if (
  location.pathname === "/live/host" ||
  location.pathname === "/live/join"
)
  root.render(<LiveQuiz isHost={location.pathname === "/live/host"} />);
else root.render(<Creator />);
