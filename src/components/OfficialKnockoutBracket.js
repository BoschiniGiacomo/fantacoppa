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

function KnockoutHeaderFlowSpacer({ flowTall, layout }) {
  return (
    <View
      style={[
        layout.flowCol,
        flowTall && layout.flowColTall,
        flowTall && layout.flowColCompact,
        layout.headerFlowSpacer,
      ]}
    />
  );
}

function KnockoutHeaderStageCell({ label, titleWide, layout, mirrorTwoLegPad }) {
  return (
    <View style={[layout.stageCol, titleWide && layout.stageColWide]}>
      <View style={layout.semiLabelRow}>
        <Text style={layout.stageColumnTitle}>{label}</Text>
        {mirrorTwoLegPad ? (
          <View style={layout.twoLegScoreCols}>
            <View style={layout.headerLegColSpacer} />
            <View style={layout.headerLegColSpacer} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function KnockoutHeaderFinalCell({ layout }) {
  return (
    <View style={[layout.finalCol, layout.headerFinalCol]}>
      <View style={layout.semiLabelRow}>
        <Text style={layout.stageColumnTitle}>Finale</Text>
      </View>
    </View>
  );
}

function KnockoutStageColumn({
  titleWide,
  ties,
  tieLabelPrefix,
  onPressMatch,
  LogoComponent,
  tieBlockStyles,
  layout,
}) {
  const { stageCol, stageColWide } = layout;
  return (
    <View style={[stageCol, titleWide && stageColWide, layout.stageColScroll]}>
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
      headerRow: [s.headerRow, { alignItems: 'flex-start' }],
      stageColumnTitle: [
        s.stageColumnTitle,
        {
          fontSize: 12,
          fontWeight: '800',
          color: '#6b7280',
          textTransform: 'uppercase',
          marginBottom: 0,
        },
      ],
      semiLabelRow: s.semiLabelRow,
      twoLegScoreCols: s.twoLegScoreCols,
      headerLegColSpacer: [s.headerLegColSpacer, { minWidth: 20 }],
      headerFlowSpacer: [
        s.headerFlowSpacer,
        { height: 0, marginTop: 0, minHeight: 0, overflow: 'hidden' },
      ],
      headerFinalCol: [
        s.headerFinalCol,
        { justifyContent: 'flex-start', paddingTop: 0, alignSelf: 'flex-start' },
      ],
      bracketRow: s.bracketRow,
      bracketScroll: s.bracketScroll,
      bracketScrollContent: s.bracketScrollContent,
      stageCol: hasQuarterfinals ? s.stageColScroll || s.stageCol : s.stageCol,
      stageColWide: s.stageColWide,
      stageColScroll: hasQuarterfinals ? s.stageColScroll : null,
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

  const semiHeaderLabel =
    semifinalTies.length > 1 || semifinalTies.some((t) => t.twoLegged) ? 'Semifinali' : 'Semifinale';
  const semiTwoLegged = semifinalTies.some((t) => t.twoLegged);
  const quarterTwoLegged = quarterfinalTies.some((t) => t.twoLegged);

  const header = (
    <View style={[layout.bracketRow, layout.headerRow]}>
      {hasQuarterfinals ? (
        <>
          <KnockoutHeaderStageCell
            label="Quarti"
            titleWide={flowTall}
            layout={layout}
            mirrorTwoLegPad={quarterTwoLegged}
          />
          <KnockoutHeaderFlowSpacer flowTall={flowTall} layout={layout} />
        </>
      ) : null}
      <KnockoutHeaderStageCell
        label={semiHeaderLabel}
        titleWide={flowTall}
        layout={layout}
        mirrorTwoLegPad={semiTwoLegged}
      />
      <KnockoutHeaderFlowSpacer flowTall={flowTall} layout={layout} />
      <KnockoutHeaderFinalCell layout={layout} />
    </View>
  );

  const bracketBody = (
    <View style={layout.bracketRow}>
      {hasQuarterfinals ? (
        <>
          <KnockoutStageColumn
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
