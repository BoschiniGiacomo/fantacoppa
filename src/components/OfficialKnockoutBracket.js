import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import KnockoutSemiTieBlock from './KnockoutSemiTieBlock';
import { KnockoutScoreText, hasKnockoutShootoutScore } from './KnockoutSemiTieBlock';
import {
  EMPTY_OFFICIAL_KNOCKOUT,
  groupQuarterfinalsIntoTies,
  groupSemifinalsIntoTies,
} from '../utils/knockoutBracket';

function KnockoutFlowConnector({ flowTall, layout }) {
  const { flowCol, flowColTall, flowColCompact, topArm, topArmCompact, topArmCompactTall, bottomArm, bottomArmCompact, bottomArmCompactTall, vertical, verticalCompact, verticalCompactTall, middleArm, middleArmCompact, middleArmCompactTall } =
    layout;
  return (
    <View style={[flowCol, flowTall && flowColTall, flowTall && flowColCompact]}>
      <View style={[topArm, flowTall && topArmCompact, flowTall && topArmCompactTall]} />
      <View style={[bottomArm, flowTall && bottomArmCompact, flowTall && bottomArmCompactTall]} />
      <View style={[vertical, flowTall && verticalCompact, flowTall && verticalCompactTall]} />
      <View style={[middleArm, flowTall && middleArmCompact, flowTall && middleArmCompactTall]} />
    </View>
  );
}

function KnockoutStageColumn({ title, titleWide, ties, tieLabelPrefix, onPressMatch, LogoComponent, tieBlockStyles, layout }) {
  const { stageCol, stageColWide, stageColScroll } = layout;
  return (
    <View style={[stageCol, titleWide && stageColWide, stageColScroll]}>
      <Text style={[layout.columnTitle, titleWide && layout.columnTitleWide]}>{title}</Text>
      {ties.map((tie, idx) => (
        <KnockoutSemiTieBlock
          key={`${tieLabelPrefix}-tie-${idx}-${tie.legs.map((l) => l.id).join('-')}`}
          tie={tie}
          sfIndex={idx}
          tieLabelPrefix={tieLabelPrefix}
          onPressMatch={onPressMatch}
          LogoComponent={LogoComponent}
          styles={tieBlockStyles}
        />
      ))}
    </View>
  );
}

function KnockoutFinalColumn({ finalMatch, onPressMatch, LogoComponent, tieBlockStyles, layout }) {
  const finalHasShootout = hasKnockoutShootoutScore(finalMatch);
  return (
    <View style={layout.finalCol}>
      <View style={layout.finalLabelRow} />
      <TouchableOpacity
        style={layout.matchStackMeasure}
        activeOpacity={0.78}
        disabled={!finalMatch?.id}
        onPress={() => onPressMatch?.(finalMatch?.id)}
        accessibilityRole={finalMatch?.id ? 'button' : undefined}
        accessibilityLabel={finalMatch?.id ? 'Apri partita finale' : undefined}
      >
        <View style={layout.matchStack}>
          <View style={layout.teamBox}>
            <View style={layout.teamRow}>
              {finalMatch?.home_team_name ? (
                <LogoComponent logoUrl={finalMatch?.home_team_logo_url} logoPath={finalMatch?.home_team_logo_path} />
              ) : (
                <View style={layout.logoPlaceholder} />
              )}
              <Text style={layout.teamText} numberOfLines={1}>
                {finalMatch?.home_team_name || '-'}
              </Text>
              <View style={layout.scoreBox}>
                <KnockoutScoreText
                  score={finalMatch?.home_score}
                  shootoutScore={finalHasShootout ? finalMatch?.home_shootout_score : null}
                  styles={tieBlockStyles}
                />
              </View>
            </View>
          </View>
          <View style={layout.teamBox}>
            <View style={layout.teamRow}>
              {finalMatch?.away_team_name ? (
                <LogoComponent logoUrl={finalMatch?.away_team_logo_url} logoPath={finalMatch?.away_team_logo_path} />
              ) : (
                <View style={layout.logoPlaceholder} />
              )}
              <Text style={layout.teamText} numberOfLines={1}>
                {finalMatch?.away_team_name || '-'}
              </Text>
              <View style={layout.scoreBox}>
                <KnockoutScoreText
                  score={finalMatch?.away_score}
                  shootoutScore={finalHasShootout ? finalMatch?.away_shootout_score : null}
                  styles={tieBlockStyles}
                />
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Tabellone fasi finali: Quarti (se presenti) → Semifinali → Finale.
 * Con quarti: scroll orizzontale.
 */
export default function OfficialKnockoutBracket({
  knockout = EMPTY_OFFICIAL_KNOCKOUT,
  onPressMatch,
  LogoComponent,
  tieBlockStyles,
  layoutStyles,
}) {
  const k = knockout || EMPTY_OFFICIAL_KNOCKOUT;
  const quarterfinalTies = useMemo(() => groupQuarterfinalsIntoTies(k.quarterfinals), [k.quarterfinals]);
  const semifinalTies = useMemo(() => groupSemifinalsIntoTies(k.semifinals), [k.semifinals]);
  const hasQuarterfinals = quarterfinalTies.length > 0;
  const flowTall =
    semifinalTies.some((t) => t.twoLegged) ||
    quarterfinalTies.some((t) => t.twoLegged) ||
    quarterfinalTies.length > 2;

  const layout = useMemo(() => {
    const s = layoutStyles || {};
    return {
      headerRow: s.headerRow,
      columnTitle: s.columnTitle,
      columnTitleWide: s.columnTitleWide,
      columnTitleSpacer: s.columnTitleSpacer,
      columnTitleSpacerCompact: s.columnTitleSpacerCompact,
      bracketRow: s.bracketRow,
      bracketScroll: s.bracketScroll,
      bracketScrollContent: s.bracketScrollContent,
      stageCol: hasQuarterfinals ? s.stageColScroll || s.stageCol : s.stageCol,
      stageColWide: s.stageColWide,
      stageColScroll: s.stageColScroll,
      flowCol: s.flowCol,
      flowColTall: s.flowColTall,
      flowColCompact: s.flowColCompact,
      topArm: s.bracketTopArm,
      topArmCompact: s.bracketTopArmCompact,
      topArmCompactTall: s.bracketTopArmCompactTall,
      bottomArm: s.bracketBottomArm,
      bottomArmCompact: s.bracketBottomArmCompact,
      bottomArmCompactTall: s.bracketBottomArmCompactTall,
      vertical: s.bracketVertical,
      verticalCompact: s.bracketVerticalCompact,
      verticalCompactTall: s.bracketVerticalCompactTall,
      middleArm: s.bracketMiddleArm,
      middleArmCompact: s.bracketMiddleArmCompact,
      middleArmCompactTall: s.bracketMiddleArmCompactTall,
      finalCol: s.finalCol,
      finalLabelRow: s.finalLabelRow,
      matchStackMeasure: s.matchStackMeasure,
      matchStack: s.matchStack,
      teamBox: s.teamBox,
      teamRow: s.teamRow,
      teamText: s.teamText,
      scoreBox: s.scoreBox,
      logoPlaceholder: s.logoPlaceholder,
    };
  }, [layoutStyles, hasQuarterfinals]);

  const header = (
    <View style={layout.headerRow}>
      {hasQuarterfinals ? (
        <>
          <Text style={[layout.columnTitle, layout.columnTitleWide]}>Quarti</Text>
          <Text style={[layout.columnTitleSpacer, flowTall && layout.columnTitleSpacerCompact]} />
        </>
      ) : null}
      <Text style={[layout.columnTitle, flowTall && layout.columnTitleWide]}>
        {semifinalTies.length > 1 || semifinalTies.some((t) => t.twoLegged) ? 'Semifinali' : 'Semifinale'}
      </Text>
      <Text style={[layout.columnTitleSpacer, flowTall && layout.columnTitleSpacerCompact]} />
      <Text style={layout.columnTitle}>Finale</Text>
    </View>
  );

  const bracketBody = (
    <View style={layout.bracketRow}>
      {hasQuarterfinals ? (
        <>
          <KnockoutStageColumn
            title="Quarti"
            titleWide={flowTall}
            ties={quarterfinalTies}
            tieLabelPrefix="Q"
            onPressMatch={onPressMatch}
            LogoComponent={LogoComponent}
            tieBlockStyles={tieBlockStyles}
            layout={layout}
          />
          <KnockoutFlowConnector flowTall={flowTall} layout={layout} />
        </>
      ) : null}
      <KnockoutStageColumn
        title={
          semifinalTies.length > 1 || semifinalTies.some((t) => t.twoLegged) ? 'Semifinali' : 'Semifinale'
        }
        titleWide={flowTall}
        ties={semifinalTies}
        tieLabelPrefix="SF"
        onPressMatch={onPressMatch}
        LogoComponent={LogoComponent}
        tieBlockStyles={tieBlockStyles}
        layout={layout}
      />
      <KnockoutFlowConnector flowTall={flowTall} layout={layout} />
      <KnockoutFinalColumn
        finalMatch={k.final}
        onPressMatch={onPressMatch}
        LogoComponent={LogoComponent}
        tieBlockStyles={tieBlockStyles}
        layout={layout}
      />
    </View>
  );

  if (hasQuarterfinals) {
    return (
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={layout.bracketScroll}
          contentContainerStyle={layout.bracketScrollContent}
        >
          <View>
            {header}
            {bracketBody}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View>
      {header}
      {bracketBody}
    </View>
  );
}
