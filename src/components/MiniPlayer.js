import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { usePlayer } from "../player/PlayerContext";
import { colors } from "../theme";

export default function MiniPlayer() {
  const p = usePlayer();
  if (!p?.current) return null;

  const pct = p.duration ? (p.position / p.duration) * 100 : 0;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.bar}
        activeOpacity={0.9}
        onPress={() => p.setExpanded(true)}
      >
        <Image source={{ uri: p.current.thumbnail }} style={styles.art} />
        <View style={styles.meta}>
          <Text numberOfLines={1} style={styles.title}>
            {p.current.title}
          </Text>
          <Text numberOfLines={1} style={styles.author}>
            {p.error ? p.error : p.current.author}
          </Text>
        </View>
        <TouchableOpacity onPress={p.toggle} hitSlop={12} style={styles.btn}>
          {p.loading ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons
              name={p.isPlaying ? "pause" : "play"}
              size={24}
              color={colors.text}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={p.next} hitSlop={12} style={styles.btn}>
          <Ionicons name="play-skip-forward" size={20} color={colors.text} />
        </TouchableOpacity>
      </TouchableOpacity>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surfaceAlt },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 10,
  },
  art: { width: 40, height: 40, borderRadius: 4, backgroundColor: colors.elevated },
  meta: { flex: 1 },
  title: { color: colors.text, fontSize: 13, fontWeight: "600" },
  author: { color: colors.textMuted, fontSize: 11 },
  btn: { padding: 6 },
  track: { height: 2, backgroundColor: colors.border },
  fill: { height: 2, backgroundColor: colors.accent },
});
