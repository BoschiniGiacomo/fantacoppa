import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { KNOCKOUT_BRACKET_LOGO_SIZE } from '../utils/knockoutBracket';
import { hasPostMatchShootoutListScore, matchDisplayScoreForSide } from '../utils/matchDisplayScore';

export function hasKnockoutShootoutScore(matchRow) {
  return hasPostMatchShootoutListScore(matchRow);
}

export function KnockoutScoreText({ score, shootoutScore, styles }) {
  return (
    <View style={styles.knockoutScoreTextRow}>
      <Text style={styles.knockoutScoreText}>{score != null ? String(score) : ''}</Text>
      {shootoutScore != null ? (
        <>
          <View style={styles.knockoutShootoutDivider} />
          <Text style={styles.knockoutShootoutScoreText}>{shootoutScore}</Text>
        </>
      ) : null}
    </View>
  );
}

function teamLegScore(leg, teamId) {
  if (!leg) return { score: null, shootout: null };
  const tid = Number(teamId);
  if (!Number.isFinite(tid) || tid <= 0) return { score: null, shootout: null };
  const isHome = Number(leg.home_team_id) === tid;
  const side = isHome ? 'home' : 'away';
  const { score, shootoutScore } = matchDisplayScoreForSide(leg, side);
  return { score, shootout: shootoutScore };
}

function KnockoutScoreCell({ score, shootout, styles, onLayout }) {
  return (
    <View style={styles.knockoutScoreBox} onLayout={onLayout}>
      <KnockoutScoreText score={score} shootoutScore={shootout} styles={styles} />
    </View>
  );
}

function KnockoutTeamRow({ match, side, styles, LogoComponent }) {
  const isHome = side === 'home';
  const name = isHome ? match?.home_team_name : match?.away_team_name;
  const { score, shootoutScore } = matchDisplayScoreForSide(match, side);
  const logoUrl = isHome ? match?.home_team_logo_url : match?.away_team_logo_url;
  const logoPath = isHome ? match?.home_team_logo_path : match?.away_team_logo_path;

  return (
    <View style={styles.knockoutTeamBox}>
      <View style={styles.knockoutTeamRow}>
        {name ? (
          <LogoComponent logoUrl={logoUrl} logoPath={logoPath} size={KNOCKOUT_BRACKET_LOGO_SIZE} />
        ) : (
          <View style={styles.knockoutLogoPlaceholder} />
        )}
        <Text style={styles.knockoutTeamText} numberOfLines={1}>
          {name || '-'}
        </Text>
        <KnockoutScoreCell score={score} shootout={shootoutScore} styles={styles} />
      </View>
    </View>
  );
}

function KnockoutTwoLegTeamRow({ team, leg1, leg2, styles, LogoComponent, measureLegCols, onLegColLayout }) {
  return (
    <View style={styles.knockoutTeamBox}>
      <View style={styles.knockoutTeamRow}>
        {team?.name ? (
          <LogoComponent logoUrl={team.logo_url} logoPath={team.logo_path} size={KNOCKOUT_BRACKET_LOGO_SIZE} />
        ) : (
          <View style={styles.knockoutLogoPlaceholder} />
        )}
        <Text style={styles.knockoutTeamText} numberOfLines={1}>
          {team?.name || '-'}
        </Text>
        <View style={styles.knockoutTwoLegScoreCols}>
          <KnockoutScoreCell
            score={leg1?.score}
            shootout={leg1?.shootout}
            styles={styles}
            onLayout={
              measureLegCols
                ? (e) => onLegColLayout?.(0, e.nativeEvent.layout.width)
                : undefined
            }
          />
          <KnockoutScoreCell
            score={leg2?.score}
            shootout={leg2?.shootout}
            styles={styles}
            onLayout={
              measureLegCols
                ? (e) => onLegColLayout?.(1, e.nativeEvent.layout.width)
                : undefined
            }
          />
        </View>
      </View>
    </View>
  );
}

function KnockoutTwoLegUnifiedCard({ tie, styles, LogoComponent, onLegColLayout }) {
  const leg1 = tie.legs[0];
  const leg2 = tie.legs[1];
  const teamA = tie.teamA;
  const teamB = tie.teamB;

  return (
    <View style={styles.knockoutMatchStack}>
      <KnockoutTwoLegTeamRow
        team={teamA}
        leg1={teamLegScore(leg1, teamA?.id)}
        leg2={teamLegScore(leg2, teamA?.id)}
        styles={styles}
        LogoComponent={LogoComponent}
        measureLegCols
        onLegColLayout={onLegColLayout}
      />
      <KnockoutTwoLegTeamRow
        team={teamB}
        leg1={teamLegScore(leg1, teamB?.id)}
        leg2={teamLegScore(leg2, teamB?.id)}
        styles={styles}
        LogoComponent={LogoComponent}
      />
    </View>
  );
}

/**
 * Blocco semifinale: una partita o andata+ritorno (colonne A / R sulla riga SF).
 * Tap apre l'ultima partita del tie (ritorno se presente).
 */
function KnockoutLegColLabel({ letter, width, styles }) {
  const slotStyle = width > 0 ? { width, alignItems: 'center' } : styles.knockoutLegColLabelFallbackSlot;
  return (
    <View style={slotStyle}>
      <Text style={styles.knockoutLegColLabel}>{letter}</Text>
    </View>
  );
}

export default function KnockoutSemiTieBlock({
  tie,
  sfIndex,
  tieLabelPrefix = 'SF',
  onPressMatch,
  LogoComponent,
  styles,
}) {
  const pressId = tie?.twoLegged ? tie?.latestMatchId : tie?.legs?.[0]?.id;
  const disabled = !pressId;
  const prefix = String(tieLabelPrefix || 'SF').trim() || 'SF';
  const [legColWidths, setLegColWidths] = useState([0, 0]);

  const onLegColLayout = useCallback((idx, width) => {
    const w = Math.ceil(Number(width) || 0);
    if (w <= 0) return;
    setLegColWidths((prev) => {
      if (prev[idx] === w) return prev;
      const next = [...prev];
      next[idx] = w;
      return next;
    });
  }, []);

  return (
    <View style={styles.knockoutSemiBlock}>
      <View style={styles.knockoutSemiLabelRow}>
        <Text style={styles.knockoutSemiSmallLabel}>
          {prefix} {sfIndex + 1}
        </Text>
        {tie?.twoLegged ? (
          <View style={styles.knockoutTwoLegScoreCols}>
            <KnockoutLegColLabel letter="A" width={legColWidths[0]} styles={styles} />
            <KnockoutLegColLabel letter="R" width={legColWidths[1]} styles={styles} />
          </View>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.knockoutMatchStackMeasure}
        activeOpacity={0.78}
        disabled={disabled}
        onPress={() => onPressMatch?.(pressId)}
        accessibilityRole={disabled ? undefined : 'button'}
        accessibilityLabel={disabled ? undefined : `Apri semifinale ${sfIndex + 1}`}
      >
        <View style={styles.knockoutTieStack}>
          {tie?.twoLegged ? (
            <>
              <KnockoutTwoLegUnifiedCard
                tie={tie}
                styles={styles}
                LogoComponent={LogoComponent}
                onLegColLayout={onLegColLayout}
              />
              {tie.aggregate ? (
                <Text style={styles.knockoutAggregateText}>
                  Complessivo: {tie.aggregate.home} - {tie.aggregate.away}
                </Text>
              ) : null}
            </>
          ) : (
            <View style={styles.knockoutMatchStack}>
              <KnockoutTeamRow match={tie?.legs?.[0]} side="home" styles={styles} LogoComponent={LogoComponent} />
              <KnockoutTeamRow match={tie?.legs?.[0]} side="away" styles={styles} LogoComponent={LogoComponent} />
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}
