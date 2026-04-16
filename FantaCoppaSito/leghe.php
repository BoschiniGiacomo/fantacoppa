<?php
require_once 'functions.php';
startSession();

if (!isLoggedIn()) {
    header('Location: index.php');
    exit();
}

$availableLeagues = getAvailableLeaguesForUser(getCurrentUserId());
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Leghe - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
</head>
<body class="bg-light fc-dashboard-page fc-leghe-page">
    <div class="container fc-page-container">
        <nav class="fc-app-top-nav d-none d-lg-flex" aria-label="Navigazione desktop">
            <a class="fc-app-top-link" href="dashboard.php">
                <i class="bi bi-house"></i>
                <span>Home</span>
            </a>
            <a class="fc-app-top-link active" href="leghe.php">
                <i class="bi bi-trophy-fill"></i>
                <span>Leghe</span>
            </a>
            <a class="fc-app-top-link" href="profile.php">
                <i class="bi bi-person"></i>
                <span>Profilo</span>
            </a>
        </nav>

        <section class="fc-leghe-mobile d-lg-none">
            <div class="fc-dashboard-mobile-header">
                <h4 class="mb-0 fw-bold text-dark">Crea o unisciti a una lega</h4>
            </div>
            <div class="fc-dashboard-mobile-search">
                <i class="bi bi-search"></i>
                <input type="text" class="form-control border-0 shadow-none" id="searchAvailableLeaguesMobile" placeholder="Cerca leghe...">
            </div>
            <div class="fc-leghe-mobile-divider"></div>
            <div id="availableLeaguesContentMobile"></div>
        </section>

        <section class="fc-dashboard-desktop d-none d-lg-block">
            <div class="fc-dashboard-desktop-header">
                <h4 class="mb-0 fw-bold text-dark"><i class="bi bi-trophy me-2 text-primary"></i>Crea o unisciti a una lega</h4>
                <div class="fc-dashboard-desktop-actions">
                    <a href="create_league.php" class="btn btn-primary">
                        <i class="bi bi-plus-circle me-1"></i>Crea Nuova Lega
                    </a>
                </div>
            </div>

            <div class="fc-dashboard-desktop-search-row fc-dashboard-desktop-search-row-single">
                <div class="fc-dashboard-desktop-join">
                    <input type="text" class="form-control border-0 shadow-none" id="searchAvailableLeagues" placeholder="Cerca leghe...">
                </div>
            </div>

            <div id="availableLeaguesContent"></div>
        </section>
    </div>

    <a href="create_league.php" class="fc-leghe-fab d-lg-none" aria-label="Crea nuova lega">
        <i class="bi bi-plus-lg"></i>
    </a>

    <div class="modal fade" id="accessCodeModal" tabindex="-1" aria-labelledby="accessCodeModalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="accessCodeModalLabel">Codice di Accesso Richiesto</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p>Questa lega richiede un codice di accesso. Inseriscilo per continuare:</p>
            <input type="password" class="form-control" id="modalAccessCode" placeholder="Codice di accesso">
            <div class="invalid-feedback" id="accessCodeError"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annulla</button>
            <button type="button" class="btn btn-success" id="confirmAccessCodeBtn">Unisciti</button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="confirmJoinModal" tabindex="-1" aria-labelledby="confirmJoinModalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="confirmJoinModalLabel">Conferma Iscrizione</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p>Vuoi unirti alla lega <span id="confirmLeagueName"></span>?</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annulla</button>
            <button type="button" class="btn btn-success" id="confirmJoinBtn">Unisciti</button>
          </div>
        </div>
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
    const availableLeagues = <?php echo json_encode($availableLeagues); ?>;
    const searchInputDesktop = document.getElementById('searchAvailableLeagues');
    const searchInputMobile = document.getElementById('searchAvailableLeaguesMobile');
    const contentDesktop = document.getElementById('availableLeaguesContent');
    const contentMobile = document.getElementById('availableLeaguesContentMobile');
    let selectedLeague = null;
    let searchQuery = '';

    function openJoinFlow(league) {
        if (!league) return;
        selectedLeague = league;
        if (league.access_code) {
            document.getElementById('modalAccessCode').value = '';
            document.getElementById('accessCodeError').textContent = '';
            document.getElementById('modalAccessCode').classList.remove('is-invalid');
            new bootstrap.Modal(document.getElementById('accessCodeModal')).show();
        } else {
            document.getElementById('confirmLeagueName').textContent = league.name;
            new bootstrap.Modal(document.getElementById('confirmJoinModal')).show();
        }
    }

    function getLeagueCardHtml(league, mobile = false) {
        const autoLineupEnabled = league.auto_lineup_mode === 1 || league.auto_lineup_mode === true || league.auto_lineup_mode === '1';
        const marketClosed = league.market_locked === 1 || league.market_locked === true || league.market_locked === '1';
        const currentMatchday = league.current_matchday ? `${league.current_matchday}ª giornata` : 'Non iniziata';
        const members = Number(league.user_count || 0);
        const isPrivate = !!league.access_code;

        return `
            <div class="card h-100 fc-league-tile position-relative fc-available-league-card ${mobile ? 'fc-mobile-league-card' : ''}" data-join-league="${league.id}">
                <div class="card-body">
                    <div class="fc-mobile-card-top">
                        <div class="fc-mobile-card-title">
                            <i class="bi bi-trophy-fill text-warning"></i>
                            <span>${league.name}</span>
                        </div>
                        <span class="badge ${isPrivate ? 'bg-warning text-dark' : 'bg-success'}">${isPrivate ? 'Privata' : 'Pubblica'}</span>
                    </div>
                    <div class="fc-mobile-card-middle">
                        <span class="badge badge-role-user">Unisciti</span>
                        <span class="fc-mobile-members"><i class="bi bi-people"></i> ${members}</span>
                    </div>
                    <div class="fc-league-meta">
                        <div><i class="bi bi-calendar-event"></i> ${currentMatchday}</div>
                        <div>Auto-formazione: <span class="${autoLineupEnabled ? 'fc-value-good' : 'fc-value-bad'}">${autoLineupEnabled ? 'Si' : 'No'}</span></div>
                        <div>Mercato: <span class="${marketClosed ? 'fc-value-bad' : 'fc-value-good'}">${marketClosed ? 'Chiuso' : 'Aperto'}</span></div>
                    </div>
                </div>
            </div>
        `;
    }

    function bindJoinEvents(container) {
        container.querySelectorAll('[data-join-league]').forEach(card => {
            card.addEventListener('click', () => {
                const leagueId = Number(card.getAttribute('data-join-league'));
                const league = availableLeagues.find(l => Number(l.id) === leagueId);
                openJoinFlow(league);
            });
        });
    }

    function renderAvailableLeaguesDesktop(filtered) {
        if (!contentDesktop) return;
        if (!filtered.length) {
            contentDesktop.innerHTML = '<div class="text-center text-muted py-4">Nessuna lega disponibile.</div>';
            return;
        }

        contentDesktop.innerHTML = `
            <section class="fc-desktop-dashboard-section">
                <div class="fc-desktop-dashboard-section-title"><i class="bi bi-compass"></i> Leghe disponibili <span>(${filtered.length})</span></div>
                <div class="row g-3">
                    ${filtered.map(league => `<div class="col-12 col-xl-6">${getLeagueCardHtml(league, false)}</div>`).join('')}
                </div>
            </section>
        `;
        bindJoinEvents(contentDesktop);
    }

    function renderAvailableLeaguesMobile(filtered) {
        if (!contentMobile) return;
        if (!filtered.length) {
            contentMobile.innerHTML = `
                <div class="fc-leghe-empty-state">
                    <i class="bi bi-trophy"></i>
                    <p class="fc-leghe-empty-title">Nessuna lega disponibile</p>
                    <p class="fc-leghe-empty-subtitle">Crea una nuova lega per iniziare</p>
                </div>
            `;
            return;
        }

        contentMobile.innerHTML = `
            <section class="fc-mobile-dashboard-section">
                ${filtered.map(league => `<div class="fc-mobile-league-wrap">${getLeagueCardHtml(league, true)}</div>`).join('')}
            </section>
        `;
        bindJoinEvents(contentMobile);
    }

    function renderAllLeagues() {
        const q = searchQuery.trim().toLowerCase();
        const filtered = availableLeagues.filter(l =>
            !q || l.name.toLowerCase().includes(q) || ('' + l.id).includes(q)
        );
        renderAvailableLeaguesDesktop(filtered);
        renderAvailableLeaguesMobile(filtered);
    }

    function joinLeague(leagueId, accessCode) {
        fetch('join_league.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ league_id: leagueId, access_code: accessCode })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                if (data.redirect) {
                    window.location.href = data.redirect;
                } else {
                    window.location.href = 'dashboard.php';
                }
                return;
            }
            alert(data.error || 'Errore durante l\'iscrizione.');
        });
    }

    document.getElementById('confirmAccessCodeBtn')?.addEventListener('click', function () {
        const code = document.getElementById('modalAccessCode').value.trim();
        if (!code) {
            document.getElementById('accessCodeError').textContent = 'Inserisci il codice.';
            document.getElementById('modalAccessCode').classList.add('is-invalid');
            return;
        }
        joinLeague(selectedLeague.id, code);
        bootstrap.Modal.getInstance(document.getElementById('accessCodeModal')).hide();
    });

    document.getElementById('confirmJoinBtn')?.addEventListener('click', function () {
        joinLeague(selectedLeague.id, '');
        bootstrap.Modal.getInstance(document.getElementById('confirmJoinModal')).hide();
    });

    const onSearchInput = (value, source) => {
        searchQuery = value || '';
        if (source !== 'desktop' && searchInputDesktop) searchInputDesktop.value = searchQuery;
        if (source !== 'mobile' && searchInputMobile) searchInputMobile.value = searchQuery;
        renderAllLeagues();
    };

    searchInputDesktop?.addEventListener('input', (e) => onSearchInput(e.target.value, 'desktop'));
    searchInputMobile?.addEventListener('input', (e) => onSearchInput(e.target.value, 'mobile'));
    renderAllLeagues();
    </script>
    <nav class="fc-mobile-main-nav d-lg-none" aria-label="Navigazione principale">
        <a class="fc-mobile-main-nav-link" href="dashboard.php">
            <i class="bi bi-house"></i>
            <span>Home</span>
        </a>
        <a class="fc-mobile-main-nav-link active" href="leghe.php">
            <i class="bi bi-trophy-fill"></i>
            <span>Leghe</span>
        </a>
        <a class="fc-mobile-main-nav-link" href="profile.php">
            <i class="bi bi-person"></i>
            <span>Profilo</span>
        </a>
    </nav>
</body>
</html>
