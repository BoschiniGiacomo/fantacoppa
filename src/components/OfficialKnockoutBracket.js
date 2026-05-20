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

function KnockoutStageHeaderTitle({ label, layout, mirrorTwoLegPad }) {
  return (
    <View style={layout.semiLabelRow}>
      <Text style={layout.stageColumnTitle}>{label}</Text>
      {mirrorTwoLegPad ? (
        <View style={layout.twoLegScoreCols}>
          <View style={layout.headerLegColSpacer} />
          <View style={layout.headerLegColSpacer} />
        </View>
      ) : null}
    </View>
  );
}

function KnockoutHeaderStageCell({ label, titleWide, layout, mirrorTwoLegPad, isQuarter = false }) {
  const colStyle = isQuarter
    ? [layout.quarterCol, titleWide && layout.stageColWide]
    : [layout.stageCol, titleWide && layout.stageColWide];
  return (
    <View style={colStyle}>
      <KnockoutStageHeaderTitle label={label} layout={layout} mirrorTwoLegPad={mirrorTwoLegPad} />
    </View>
  );
}

function KnockoutHeaderFinalCell({ layout }) {
  return (
    <View style={[layout.finalCol, layout.headerFinalCol]}>
      <KnockoutStageHeaderTitle label="Finale" layout={layout} />
    </View>
  );
}

function KnockoutStageTies({ ties, tieLabelPrefix, onPressMatch, LogoComponent, tieBlockStyles }) {
  return ties.map((tie, idx) => (
    <KnockoutSemiTieBlock
      key={`${tieLabelPrefix}-tie-${idx}-${tie.legs.map((l) => l.id).join('-')}`}
      tie={tie}
      sfIndex={idx}
      tieLabelPrefix={tieLabelPrefix}
      onPressMatch={onPressMatch}
      LogoComponent={LogoComponent}
      styles={tieBlockStyles}
    />
  ));
}

function KnockoutStageColumn({
  titleWide,
  ties,
  tieLabelPrefix,
  isQuarter = false,
  bare = false,
  onPressMatch,
  LogoComponent,
  tieBlockStyles,
  layout,
}) {
  const tiesContent = (
    <KnockoutStageTies
      ties={ties}
      tieLabelPrefix={tieLabelPrefix}
      onPressMatch={onPressMatch}
      LogoComponent={LogoComponent}
      tieBlockStyles={tieBlockStyles}
    />
  );
  if (bare) return <>{tiesContent}</>;
  const colStyle = isQuarter
    ? [layout.quarterCol, titleWide && layout.stageColWide]
    : [layout.stageCol, titleWide && layout.stageColWide];
  return <View style={colStyle}>{tiesContent}</View>;
}

function KnockoutFinalMatchContent({ finalMatch, onPressMatch, LogoComponent, tieBlockStyles, layout }) {
  const finalHasShootout = hasKnockoutShootoutScore(finalMatch);
  return (
    <>
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
    </>
  );
}

function KnockoutFinalColumn({ finalMatch, onPressMatch, LogoComponent, tieBlockStyles, layout, bare = false }) {
  const content = (
    <KnockoutFinalMatchContent
      finalMatch={finalMatch}
      onPressMatch={onPressMatch}
      LogoComponent={LogoComponent}
      tieBlockStyles={tieBlockStyles}
      layout={layout}
    />
  );
  if (bare) return content;
  return <View style={layout.finalCol}>{content}</View>;
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
      quarterCol: s.stageColScroll || s.stageCol,
      stageCol: s.stageCol,
      stageColWide: s.stageColWide,
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
  }, [layoutStyles]);

  const semiHeaderLabel =
    semifinalTies.length > 1 || semifinalTies.some((t) => t.twoLegged) ? 'Semifinali' : 'Semifinale';
  const semiTwoLegged = semifinalTies.some((t) => t.twoLegged);
  const quarterTwoLegged = quarterfinalTies.some((t) => t.twoLegged);

  const commonStageProps = {
    onPressMatch,
    LogoComponent,
    tieBlockStyles,
    layout,
  };

  if (hasQuarterfinals) {
    const quarterColStyle = [layout.quarterCol, flowTall && layout.stageColWide];
    const stageColStyle = [layout.stageCol, flowTall && layout.stageColWide];
    const finalColStyle = [layout.finalCol, layout.headerFinalCol];

    return (
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={layout.bracketScroll}
          contentContainerStyle={layout.bracketScrollContent}
        >
          <View style={layout.bracketRow}>
            <View style={quarterColStyle}>
              <KnockoutStageHeaderTitle label="Quarti" layout={layout} mirrorTwoLegPad={quarterTwoLegged} />
              <KnockoutStageColumn
                ties={quarterfinalTies}
                tieLabelPrefix="Q"
                bare
                {...commonStageProps}
              />
            </View>
            <KnockoutFlowConnector flowTall={flowTall} layout={layout} />
            <View style={stageColStyle}>
              <KnockoutStageHeaderTitle
                label={semiHeaderLabel}
                layout={layout}
                mirrorTwoLegPad={semiTwoLegged}
              />
              <KnockoutStageColumn ties={semifinalTies} tieLabelPrefix="SF" bare {...commonStageProps} />
            </View>
            <KnockoutFlowConnector flowTall={flowTall} layout={layout} />
            <View style={finalColStyle}>
              <KnockoutStageHeaderTitle label="Finale" layout={layout} />
              <KnockoutFinalColumn finalMatch={k.final} bare {...commonStageProps} />
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  const header = (
    <View style={[layout.bracketRow, layout.headerRow]}>
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
      <KnockoutStageColumn titleWide={flowTall} ties={semifinalTies} tieLabelPrefix="SF" {...commonStageProps} />
      <KnockoutFlowConnector flowTall={flowTall} layout={layout} />
      <KnockoutFinalColumn finalMatch={k.final} {...commonStageProps} />
    </View>
  );

  return (
    <View>
      {header}
      {bracketBody}
    </View>
  );
}
