import { createRoot } from "react-dom/client";
import { CaseHandoff } from "./case-handoff.tsx";
import { Creator } from "./creator.tsx";
import { Operations } from "./operations.tsx";
import { Respondent } from "./respondent.tsx";

const target = document.getElementById("app");
if (!target) throw new Error("Application root missing");

const token = /^\/respond\/([A-Za-z0-9_-]{43})$/.exec(location.pathname)?.[1];
const root = createRoot(target);
if (token) root.render(<Respondent token={token} />);
else if (location.pathname === "/admin") root.render(<Operations />);
else if (location.pathname === "/case-handoff") root.render(<CaseHandoff />);
else root.render(<Creator />);
