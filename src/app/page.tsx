import { AuthGuard } from "@/components/auth-guard";
import { FileBrowser } from "@/components/file-browser";
import { PlayerBar } from "@/components/player/player-bar";

export default function Home() {
  return (
    <AuthGuard>
      <FileBrowser />
      <PlayerBar />
    </AuthGuard>
  );
}
