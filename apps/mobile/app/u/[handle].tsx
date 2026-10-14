import { useLocalSearchParams } from "expo-router";
import { ProfileView } from "../../src/features/profile/ProfileView";

export default function UserProfile() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  return <ProfileView handle={handle} />;
}
