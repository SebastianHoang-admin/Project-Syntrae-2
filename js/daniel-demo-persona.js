(function () {
  const DANIEL_DEMO_ANSWERS = {
    "L1_A1_Q1": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A1", "layerId": "L1" },
    "L1_A1_Q2": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A1", "layerId": "L1" },
    "L1_A1_Q3": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A1", "layerId": "L1" },
    "L1_A2_Q1": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A2", "layerId": "L1" },
    "L1_A2_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A2", "layerId": "L1" },
    "L1_A2_Q3": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A2", "layerId": "L1" },
    "L1_A3_Q1": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A3", "layerId": "L1" },
    "L1_A3_Q2": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A3", "layerId": "L1" },
    "L1_A3_Q3": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A3", "layerId": "L1" },
    "L1_A4_Q1": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A4", "layerId": "L1" },
    "L1_A4_Q2": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A4", "layerId": "L1" },
    "L1_A4_Q3": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A4", "layerId": "L1" },
    "L1_A5_Q1": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A5", "layerId": "L1" },
    "L1_A5_Q2": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A5", "layerId": "L1" },
    "L1_A5_Q3": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L1_A5", "layerId": "L1" },
    "L1_A6_Q1": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A6", "layerId": "L1" },
    "L1_A6_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L1_A6", "layerId": "L1" },
    "L1_A6_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L1_A6", "layerId": "L1" },
    "L2_A1_Q1": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A1", "layerId": "L2" },
    "L2_A1_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A1", "layerId": "L2" },
    "L2_A1_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A1", "layerId": "L2" },
    "L2_A2_Q1": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A2", "layerId": "L2" },
    "L2_A2_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A2", "layerId": "L2" },
    "L2_A2_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A2", "layerId": "L2" },
    "L2_A3_Q1": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A3", "layerId": "L2" },
    "L2_A3_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A3", "layerId": "L2" },
    "L2_A3_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A3", "layerId": "L2" },
    "L2_A4_Q1": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L2_A4", "layerId": "L2" },
    "L2_A4_Q2": { "option": 2, "confidence": 4, "value": 0.25, "axisId": "L2_A4", "layerId": "L2" },
    "L2_A4_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A4", "layerId": "L2" },
    "L2_A5_Q1": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A5", "layerId": "L2" },
    "L2_A5_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A5", "layerId": "L2" },
    "L2_A5_Q3": { "option": 3, "confidence": 4, "value": 0.5, "axisId": "L2_A5", "layerId": "L2" },
    "L2_A6_Q1": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A6", "layerId": "L2" },
    "L2_A6_Q2": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A6", "layerId": "L2" },
    "L2_A6_Q3": { "option": 4, "confidence": 4, "value": 0.75, "axisId": "L2_A6", "layerId": "L2" },
    "L3_A1_Q1": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A1", "layerId": "L3" },
    "L3_A1_Q2": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A1", "layerId": "L3" },
    "L3_A1_Q3": { "option": 5, "confidence": 5, "value": 1, "axisId": "L3_A1", "layerId": "L3" },
    "L3_A2_Q1": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A2", "layerId": "L3" },
    "L3_A2_Q2": { "option": 5, "confidence": 5, "value": 1, "axisId": "L3_A2", "layerId": "L3" },
    "L3_A2_Q3": { "option": 5, "confidence": 5, "value": 1, "axisId": "L3_A2", "layerId": "L3" },
    "L3_A3_Q1": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A3", "layerId": "L3" },
    "L3_A3_Q2": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A3", "layerId": "L3" },
    "L3_A3_Q3": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A3", "layerId": "L3" },
    "L3_A4_Q1": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A4", "layerId": "L3" },
    "L3_A4_Q2": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A4", "layerId": "L3" },
    "L3_A4_Q3": { "option": 3, "confidence": 5, "value": 0.5, "axisId": "L3_A4", "layerId": "L3" },
    "L3_A5_Q1": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A5", "layerId": "L3" },
    "L3_A5_Q2": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A5", "layerId": "L3" },
    "L3_A5_Q3": { "option": 4, "confidence": 5, "value": 0.75, "axisId": "L3_A5", "layerId": "L3" },
    "L3_A6_Q1": { "option": 3, "confidence": 5, "value": 0.5, "axisId": "L3_A6", "layerId": "L3" },
    "L3_A6_Q2": { "option": 3, "confidence": 5, "value": 0.5, "axisId": "L3_A6", "layerId": "L3" },
    "L3_A6_Q3": { "option": 2, "confidence": 5, "value": 0.25, "axisId": "L3_A6", "layerId": "L3" },
    "L4_A1_Q1": { "type": "multi", "selected": ["Witty", "Lighthearted", "Reserved"], "axisId": "L4_A1", "layerId": "L4" },
    "L4_A1_Q2": { "type": "multi", "selected": ["Relaxed", "Lighthearted", "Quiet"], "axisId": "L4_A1", "layerId": "L4" },
    "L4_A1_Q3": { "type": "multi", "selected": ["Witty", "Entertaining", "Calm"], "axisId": "L4_A1", "layerId": "L4" },
    "L4_A2_Q1": { "type": "multi", "selected": ["Warm", "Approachable", "Open"], "axisId": "L4_A2", "layerId": "L4" },
    "L4_A2_Q2": { "type": "multi", "selected": ["Caring", "Understanding", "Gentle"], "axisId": "L4_A2", "layerId": "L4" },
    "L4_A2_Q3": { "type": "multi", "selected": ["Friendly", "Warm", "Relaxed"], "axisId": "L4_A2", "layerId": "L4" },
    "L4_A3_Q1": { "type": "multi", "selected": ["Honest", "Careful", "Diplomatic"], "axisId": "L4_A3", "layerId": "L4" },
    "L4_A3_Q2": { "type": "multi", "selected": ["Clear", "Careful", "Polite"], "axisId": "L4_A3", "layerId": "L4" },
    "L4_A3_Q3": { "type": "multi", "selected": ["Honest", "Gentle", "Careful"], "axisId": "L4_A3", "layerId": "L4" },
    "L4_A4_Q1": { "type": "multi", "selected": ["Calm", "Steady", "Low-key"], "axisId": "L4_A4", "layerId": "L4" },
    "L4_A4_Q2": { "type": "multi", "selected": ["Relaxed", "Engaging", "Steady"], "axisId": "L4_A4", "layerId": "L4" },
    "L4_A4_Q3": { "type": "multi", "selected": ["Calm", "Grounded", "Alert"], "axisId": "L4_A4", "layerId": "L4" },
    "L4_A5_Q1": { "type": "multi", "selected": ["Composed", "Open", "Subtle"], "axisId": "L4_A5", "layerId": "L4" },
    "L4_A5_Q2": { "type": "multi", "selected": ["Composed", "Reserved", "Quiet"], "axisId": "L4_A5", "layerId": "L4" },
    "L4_A5_Q3": { "type": "multi", "selected": ["Composed", "Reserved", "Guarded"], "axisId": "L4_A5", "layerId": "L4" },
    "L4_A6_Q1": { "type": "multi", "selected": ["Casual", "Easygoing", "Reserved"], "axisId": "L4_A6", "layerId": "L4" },
    "L4_A6_Q2": { "type": "multi", "selected": ["Friendly", "Polite", "Relaxed"], "axisId": "L4_A6", "layerId": "L4" },
    "L4_A6_Q3": { "type": "multi", "selected": ["Professional", "Polished", "Proper"], "axisId": "L4_A6", "layerId": "L4" },
    "L5_S1_F1": { "type": "free", "text": "Black American.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "race" },
    "L5_S1_F2": { "type": "free", "text": "English primarily, with some conversational Spanish.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "languages" },
    "L5_S1_F3": { "type": "free", "text": "Not strongly religious from what Maya knows, but respectful of other people's beliefs.", "sectionId": "L5_S1", "layerId": "L5", "fieldName": "religion" },
    "L5_S2_F1": { "type": "free", "text": "Graduate student in product design with part-time freelance UX work.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "current_status" },
    "L5_S2_F2": { "type": "free", "text": "San Francisco State University graduate program.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "school_university" },
    "L5_S2_F3": { "type": "free", "text": "He wants to build thoughtful consumer products and eventually lead design at a mission-driven company.", "sectionId": "L5_S2", "layerId": "L5", "fieldName": "aspirations" },
    "L5_S3_F1": { "type": "free", "text": "Campus project teams, design studios, quiet cafes, the climbing gym, and a close Bay Area friend circle.", "sectionId": "L5_S3", "layerId": "L5", "fieldName": "communities" },
    "L5_S3_F2": { "type": "free", "text": "Mostly one-on-one hangouts, small dinners, and planned meetups rather than loud parties.", "sectionId": "L5_S3", "layerId": "L5", "fieldName": "environment_style" },
    "L5_S4_F1": { "type": "free", "text": "Basketball, climbing, design research, playlists, and weekend cafe hopping.", "sectionId": "L5_S4", "layerId": "L5", "fieldName": "hobbies" },
    "L5_S4_F2": { "type": "free", "text": "Fairly invested. His hobbies look like a real part of his weekly routine.", "sectionId": "L5_S4", "layerId": "L5", "fieldName": "engagement_level" },
    "L5_S5_F1": { "type": "free", "text": "R&B, mellow hip-hop, indie pop, Afrobeats, and thoughtful singer-songwriter playlists.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "music" },
    "L5_S5_F2": { "type": "free", "text": "Character-driven dramas, smart comedies, design documentaries, and relationship-centered films.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "shows_movies" },
    "L5_S5_F3": { "type": "free", "text": "Occasional FIFA, social party games, and the occasional strategy board game.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "games" },
    "L5_S5_F4": { "type": "free", "text": "Clean, minimal, practical, slightly curated, with neutral tones and good sneakers.", "sectionId": "L5_S5", "layerId": "L5", "fieldName": "aesthetic_style" },
    "L6_S1_F1": { "type": "free", "text": "No major physical limitations known.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "physical_incapability" },
    "L6_S1_F2": { "type": "free", "text": "Reckless dares, humiliating public stunts, and chaotic late-night social scenes.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "hard_no_activities" },
    "L6_S1_F3": { "type": "free", "text": "He does not respond well to emotional ultimatums, public embarrassment, or being pressured into labels on the spot.", "sectionId": "L6_S1", "layerId": "L6", "fieldName": "absolute_boundaries" },
    "L6_S2_F1": { "type": "free", "text": "Good pasta, Korean barbecue, sushi, and strong coffee desserts.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "favorite_dishes" },
    "L6_S2_F2": { "type": "free", "text": "Earth tones, forest green, charcoal, and navy.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "favorite_colors" },
    "L6_S2_F3": { "type": "free", "text": "Coffee walks, design exhibits, bookstore browsing, dinner in quiet places, and low-key weekend trips.", "sectionId": "L6_S2", "layerId": "L6", "fieldName": "preferred_activities" },
    "L6_S3_F1": { "type": "free", "text": "Crowded clubs, flaky planning, condescending people, forced vulnerability, and performative drama.", "sectionId": "L6_S3", "layerId": "L6", "fieldName": "extreme_dislikes" },
    "L6_S3_F2": { "type": "free", "text": "Warm sincerity, clear invitations, thoughtful follow-through, relaxed humor, and good taste.", "sectionId": "L6_S3", "layerId": "L6", "fieldName": "strong_likes" },
    "extra_time_life": { "type": "free", "text": "Grad school, freelance work, and a relationship that is becoming more intentional are all happening at once.", "layerId": "EXTRA", "fieldName": "extra_time_life" },
    "extra_current_context": { "type": "free", "text": "He is balancing deadlines while sensing that the relationship may need a more explicit conversation soon.", "layerId": "EXTRA", "fieldName": "extra_current_context" },
    "extra_stressors": { "type": "free", "text": "School deadlines, money management, and uncertainty about whether the timing is right to define the relationship.", "layerId": "EXTRA", "fieldName": "extra_stressors" },
    "extra_cultural_moment": { "type": "free", "text": "He moves in ambitious Bay Area circles that value independence, but he still respects direct and considerate communication.", "layerId": "EXTRA", "fieldName": "extra_cultural_moment" },
    "extra_relationship_role": { "type": "free", "text": "Romantic interest the user is trying to understand and approach with care.", "layerId": "EXTRA", "fieldName": "extra_relationship_role" }
  };

  const DANIEL_DEMO_EXTRAS = {
    "basic-profile": "Daniel Smith. Male. 23 yrs old. Graduate student in product design living in the Bay Area.",
    "relationship-role": "Romantic interest and close relationship focus for Maya Chen.",
    "current-context": "Maya and Daniel have been spending more intentional time together. The relationship feels promising, but neither person has clearly named where it is going yet.",
    "communication-pattern": "Responds well to warmth, sincerity, and specific invitations. He can become reserved when the tone feels like an urgent decision must be made immediately.",
    "emotional-needs": "Needs room to think, a sense that his answer is welcome either way, and a conversation that feels mutual rather than like a test.",
    "stressors": "Academic deadlines, part-time project work, and uncertainty about whether defining the relationship too quickly could change the easy trust he and Maya have built.",
    "decision-context": "Best Way should weigh clarity against pressure and prefer messages that invite honest conversation without cornering either person."
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function buildIdentityLayersFromAnswers(answers) {
    const buckets = { L1: {}, L2: {}, L3: {} };
    Object.values(answers).forEach((answer) => {
      if (!answer || !answer.axisId || !answer.layerId || !buckets[answer.layerId]) return;
      if (typeof answer.value !== 'number') return;
      const confidence = Math.max(1, Math.min(5, Number(answer.confidence) || 3)) / 5;
      if (!buckets[answer.layerId][answer.axisId]) buckets[answer.layerId][answer.axisId] = [];
      buckets[answer.layerId][answer.axisId].push({
        value: Math.max(0, Math.min(1, answer.value)),
        confidence
      });
    });

    const identityLayers = {};
    ['L1', 'L2', 'L3'].forEach((layerId) => {
      const result = {};
      Object.entries(buckets[layerId]).forEach(([axisId, values]) => {
        if (!values.length) return;
        const weightedValue = values.reduce((sum, item) => sum + item.value * item.confidence, 0);
        const confidenceMass = values.reduce((sum, item) => sum + item.confidence, 0) || values.length;
        const avg = weightedValue / confidenceMass;
        const avgConfidence = values.reduce((sum, item) => sum + item.confidence, 0) / values.length;
        result[axisId] = {
          value: Number(avg.toFixed(4)),
          confidence: Number(avgConfidence.toFixed(4))
        };
      });
      identityLayers[layerId] = JSON.stringify(result);
    });

    return identityLayers;
  }

  function buildDanielDemoPersonaState(options = {}) {
    const answers = clone(DANIEL_DEMO_ANSWERS);
    return {
      version: 1,
      savedAt: options.savedAt || '2026-07-06T00:00:00.000Z',
      personaName: 'Daniel Smith',
      personaPortrait: options.portraitDataUrl || 'assets/daniel-smith-avatar.png',
      personaAvatarPresent: 'yes',
      answers,
      session: {
        visibleIds: Object.keys(answers),
        currentIndex: 0
      },
      usersInput: 'Daniel Smith is a 23-year-old graduate student in product design. He is warm, thoughtful, and open to sincere conversation when it is framed gently. He values emotional honesty, independence, and steady pacing, but can become quiet if a conversation feels rushed or too emotionally loaded at the wrong time.',
      identityLayers: buildIdentityLayersFromAnswers(answers),
      extras: clone(DANIEL_DEMO_EXTRAS)
    };
  }

  window.DANIEL_DEMO_ANSWERS = DANIEL_DEMO_ANSWERS;
  window.buildDanielDemoPersonaState = buildDanielDemoPersonaState;
})();
