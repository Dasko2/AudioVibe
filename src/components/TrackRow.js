import { Ionicons } from "@expo/vector-icons";
import React, { useRef } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, font } from "../theme";

export const fmt = (s = 0) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

export default function TrackRow({ track, onPress, onLongPress, right, active }) {
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (to) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      damping: 15,
      stiffness: 240,
      mass: 0.7,
    }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        style={styles.row}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => spring(0.97)}
        onPressOut={() => spring(1)}
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
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 12 },
  art: { width: 52, height: 52, borderRadius: 4, backgroundColor: colors.elevated },
  meta: { flex: 1 },
});
