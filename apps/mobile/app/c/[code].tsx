import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { resolveChallenge } from "../../src/lib/api";
import { Button } from "../../src/ui/Button";
import { Skeleton } from "../../src/ui/Skeleton";
import { T } from "../../src/ui/Text";
import { c, layout, space } from "../../src/ui/theme";

/** thumbcade://c/<code>: resolve the challenge, then open its game first with ctx.challenge. */
export default function ChallengeLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    resolveChallenge(code)
      .then((r) => {
        if (!alive) return;
        router.replace({
          pathname: "/",
          params: { first: r.gameSlug, code: r.code, from: r.fromName, score: r.score === null ? "" : String(r.score), n: String(Date.now()) },
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [code]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: "center", padding: layout.gutter, gap: space[4] }}>
      {failed ? (
        <>
          <T variant="display3">That challenge expired or never existed.</T>
          <T variant="body" color="textDim">
            The link might be mistyped. The feed is still full of scores to beat.
          </T>
          <Button label="Open the feed" onPress={() => router.replace("/")} />
        </>
      ) : (
        <View style={{ gap: space[3] }} accessibilityLabel="Opening challenge">
          <Skeleton style={{ width: 160, height: 14 }} />
          <Skeleton style={{ width: 260, height: 32 }} />
        </View>
      )}
    </View>
  );
}
