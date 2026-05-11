import React from "react";
import { Box, Text } from "ink";

export const MetricCard = (props: { label: string; value: string; color?: string | undefined }) => (
  <Box flexDirection="column" marginRight={2}>
    <Text dimColor>{props.label}</Text>
    {props.color ? <Text color={props.color}>{props.value}</Text> : <Text>{props.value}</Text>}
  </Box>
);
