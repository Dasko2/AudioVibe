import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors, font } from "../theme";

export const fmt = (s = 0) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

export default function TrackRow({ track, onPress, onLongPress, right, active }) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: track.thumbnail }}
        style={styles.art}
        resizeMode="cover"
      />
      <View style={styles.meta}>
        <Text
          numberOfLines={1}
          style={[font.body, active && { color: colors.accent }]}
        >
          {track.title}
        </Text>
        <Text numberOfLines={1} style={font.muted}>
          {track.author}
          {track.duration ? ` · ${fmt(track.duration)}` : ""}
        </Text>
      </View>
      {right ?? (
        <Ionicons name="ellipsis-vertical" size={18} color={colors.textMuted} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 12 },
  art: { width: 52, height: 52, borderRadius: 4, backgroundColor: colors.elevated },
  meta: { flex: 1 },
});
