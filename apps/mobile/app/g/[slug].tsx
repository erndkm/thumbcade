import { useEffect } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { c } from "../../src/ui/theme";

/** thumbcade://g/<slug> and https://thumbcade.com/g/<slug>: open the feed with that game first. */
export default function GameLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  useEffect(() => {
    router.replace({ pathname: "/", params: { first: slug, n: String(Date.now()) } });
  }, [slug]);
  return <View style={{ flex: 1, backgroundColor: c.bg }} />;
}
