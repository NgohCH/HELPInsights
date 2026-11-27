import { createRoot } from "react-dom/client";
import { Creator } from "./creator.tsx";
import { Respondent } from "./respondent.tsx";

const target = document.getElementById("app");
if (!target) throw new Error("Application root missing");

const token = /^\/respond\/([A-Za-z0-9_-]{43})$/.exec(location.pathname)?.[1];
createRoot(target).render(token ? <Respondent token={token} /> : <Creator />);
