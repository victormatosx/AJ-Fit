import type { ExerciseSeedInput } from '../types/exercise';
import type { CanonicalActivity } from '../workoutPrescription/canonicalActivities';
import type { FinalWorkoutExercise, TemplateEnvironment } from '../workoutPrescription/types';




const resistanceDrafts: ExerciseSeedInput[] = [
  {
    "id": "cable-hip-abduction",
    "slug": "cable-hip-abduction",
    "name": {
      "ptBR": "Abdução de Quadril na Polia",
      "en": "Cable Hip Abduction",
      "es": "Abducción de Cadera en Polea"
    },
    "target": {
      "primaryMuscle": "abductors",
      "secondaryMuscles": [
        "glutes"
      ]
    },
    "movement": {
      "pattern": "hip_abduction",
      "mechanic": "isolation",
      "laterality": "unilateral"
    },
    "equipment": [
      "cable"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Prenda a tornozeleira à polia baixa. Em pé de lado para a polia e com apoio estável, afaste a perna lateralmente sem inclinar o tronco e retorne com controle."
      ],
      "en": [
        "Attach an ankle cuff to a low cable. Stand sideways with stable support, move the leg out to the side without leaning and return under control."
      ],
      "es": [
        "Sujete la tobillera a la polea baja. De pie de lado y con apoyo estable, separe la pierna lateralmente sin inclinar el tronco y vuelva con control."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "cable-hip-adduction",
    "slug": "cable-hip-adduction",
    "name": {
      "ptBR": "Adução de Quadril na Polia",
      "en": "Cable Hip Adduction",
      "es": "Aducción de Cadera en Polea"
    },
    "target": {
      "primaryMuscle": "adductors",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "hip_adduction",
      "mechanic": "isolation",
      "laterality": "unilateral"
    },
    "equipment": [
      "cable"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Prenda a tornozeleira à polia baixa. Com apoio estável e a perna mais próxima da polia afastada, aproxime-a da linha média sem girar o quadril e retorne devagar."
      ],
      "en": [
        "Attach an ankle cuff to a low cable. With stable support and the near leg out to the side, bring it toward the midline without rotating the pelvis and return slowly."
      ],
      "es": [
        "Sujete la tobillera a la polea baja. Con apoyo estable y la pierna cercana separada, llévela hacia la línea media sin girar la pelvis y vuelva despacio."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "dumbbell-stationary-lunge",
    "slug": "dumbbell-stationary-lunge",
    "name": {
      "ptBR": "Afundo com Halteres",
      "en": "Dumbbell Stationary Lunge",
      "es": "Zancada Estática con Mancuernas"
    },
    "target": {
      "primaryMuscle": "quads",
      "secondaryMuscles": [
        "glutes",
        "hamstrings"
      ]
    },
    "movement": {
      "pattern": "lunge",
      "mechanic": "compound",
      "laterality": "unilateral"
    },
    "equipment": [
      "dumbbell"
    ],
    "bodyPosition": "standing",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Segure os halteres ao lado do corpo em base afastada. Flexione os joelhos mantendo os pés fixos e o tronco estável; empurre o chão para retornar e depois troque a perna da frente."
      ],
      "en": [
        "Hold dumbbells at your sides in a split stance. Bend the knees with feet fixed and torso stable, push through the floor to rise, then change the lead leg."
      ],
      "es": [
        "Sostenga las mancuernas a los lados en posición dividida. Flexione las rodillas con los pies fijos y el tronco estable, empuje el suelo para subir y cambie la pierna delantera."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "dumbbell-sumo-squat",
    "slug": "dumbbell-sumo-squat",
    "name": {
      "ptBR": "Agachamento Sumô com Halter",
      "en": "Dumbbell Sumo Squat",
      "es": "Sentadilla Sumo con Mancuerna"
    },
    "target": {
      "primaryMuscle": "quads",
      "secondaryMuscles": [
        "glutes",
        "adductors"
      ]
    },
    "movement": {
      "pattern": "squat",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "dumbbell"
    ],
    "bodyPosition": "standing",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Em base ampla com pés levemente voltados para fora, segure um halter entre as pernas. Flexione joelhos e quadris em agachamento, acompanhando a direção dos pés, e retorne sem arredondar as costas."
      ],
      "en": [
        "Stand wide with toes slightly out and hold a dumbbell between the legs. Bend knees and hips into a squat, track knees with toes and rise without rounding the back."
      ],
      "es": [
        "Con base amplia y puntas ligeramente hacia fuera, sostenga una mancuerna entre las piernas. Flexione rodillas y caderas en sentadilla siguiendo la dirección de los pies y suba sin redondear la espalda."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "pull-up",
    "slug": "pull-up",
    "name": {
      "ptBR": "Barra Fixa",
      "en": "Pull-Up",
      "es": "Dominada"
    },
    "target": {
      "primaryMuscle": "lats",
      "secondaryMuscles": [
        "biceps",
        "upper_back"
      ]
    },
    "movement": {
      "pattern": "vertical_pull",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "bodyweight"
    ],
    "bodyPosition": "hanging",
    "difficulty": "advanced",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Use uma barra fixa estável com pegada pronada. Partindo da suspensão, puxe o corpo sem balanço até aproximar o queixo da barra e desça de forma controlada."
      ],
      "en": [
        "Use a secure pull-up bar with an overhand grip. From a hang, pull up without swinging until the chin approaches the bar, then lower under control."
      ],
      "es": [
        "Use una barra fija estable con agarre prono. Desde la suspensión, suba sin balanceo hasta acercar el mentón a la barra y baje con control."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "wall-sit",
    "slug": "wall-sit",
    "name": {
      "ptBR": "Cadeirinha na Parede",
      "en": "Wall Sit",
      "es": "Sentadilla Isométrica en Pared"
    },
    "target": {
      "primaryMuscle": "quads",
      "secondaryMuscles": [
        "glutes"
      ]
    },
    "movement": {
      "pattern": "squat",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "bodyweight"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Apoie as costas na parede e avance os pés. Deslize até uma posição de agachamento sustentável, mantenha os joelhos alinhados aos pés e sustente pelo tempo prescrito antes de subir."
      ],
      "en": [
        "Place your back against a wall and step the feet forward. Slide into a sustainable squat, keep knees aligned with feet and hold for the prescribed time before rising."
      ],
      "es": [
        "Apoye la espalda en la pared y adelante los pies. Deslice hasta una sentadilla sostenible, alinee las rodillas con los pies y mantenga durante el tiempo indicado antes de subir."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "reverse-pec-deck",
    "slug": "reverse-pec-deck",
    "name": {
      "ptBR": "Crucifixo Inverso na Máquina",
      "en": "Reverse Pec Deck",
      "es": "Aperturas Inversas en Máquina"
    },
    "target": {
      "primaryMuscle": "rear_deltoid",
      "secondaryMuscles": [
        "upper_back",
        "traps"
      ]
    },
    "movement": {
      "pattern": "horizontal_pull",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "machine"
    ],
    "bodyPosition": "seated",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Ajuste o banco e sente-se voltado para o encosto, apoiando o peito. Com cotovelos levemente flexionados, abra os braços para trás sem elevar os ombros e retorne com controle."
      ],
      "en": [
        "Adjust the seat and face the backrest with chest supported. Keep a slight elbow bend, open the arms backward without shrugging and return under control."
      ],
      "es": [
        "Ajuste el asiento y siéntese mirando al respaldo con el pecho apoyado. Con codos ligeramente flexionados, abra los brazos hacia atrás sin elevar los hombros y vuelva con control."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "resistance-band-chest-fly",
    "slug": "resistance-band-chest-fly",
    "name": {
      "ptBR": "Crucifixo com Elástico",
      "en": "Resistance Band Chest Fly",
      "es": "Aperturas de Pecho con Banda"
    },
    "target": {
      "primaryMuscle": "chest",
      "secondaryMuscles": [
        "front_deltoid"
      ]
    },
    "movement": {
      "pattern": "horizontal_adduction",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "resistance_band"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Fixe o elástico atrás do corpo em um ponto estável na altura do peito. Com cotovelos levemente flexionados, aproxime as mãos à frente em arco e retorne sem perder o controle da tensão."
      ],
      "en": [
        "Secure the band behind you at chest height. With slightly bent elbows, bring the hands together in an arc in front and return while controlling the tension."
      ],
      "es": [
        "Fije la banda detrás del cuerpo a la altura del pecho. Con codos ligeramente flexionados, junte las manos delante en arco y vuelva controlando la tensión."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "arnold-dumbbell-press",
    "slug": "arnold-dumbbell-press",
    "name": {
      "ptBR": "Desenvolvimento Arnold",
      "en": "Arnold Dumbbell Press",
      "es": "Press Arnold con Mancuernas"
    },
    "target": {
      "primaryMuscle": "front_deltoid",
      "secondaryMuscles": [
        "side_deltoid",
        "triceps"
      ]
    },
    "movement": {
      "pattern": "vertical_push",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "dumbbell",
      "bench"
    ],
    "bodyPosition": "seated",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Sente-se em banco com encosto, com halteres à frente dos ombros e palmas voltadas para o rosto. Eleve os halteres girando gradualmente as palmas para a frente e retorne invertendo o movimento, sem arquear a lombar."
      ],
      "en": [
        "Sit on a supported bench with dumbbells in front of the shoulders and palms facing you. Press up while gradually rotating palms forward, then reverse the motion without arching the lower back."
      ],
      "es": [
        "Siéntese en un banco con respaldo, con mancuernas frente a los hombros y palmas hacia el rostro. Empuje hacia arriba girando las palmas al frente y vuelva invirtiendo el movimiento sin arquear la zona lumbar."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "smith-machine-shoulder-press",
    "slug": "smith-machine-shoulder-press",
    "name": {
      "ptBR": "Desenvolvimento no Smith",
      "en": "Smith Machine Shoulder Press",
      "es": "Press de Hombros en Smith"
    },
    "target": {
      "primaryMuscle": "front_deltoid",
      "secondaryMuscles": [
        "side_deltoid",
        "triceps"
      ]
    },
    "movement": {
      "pattern": "vertical_push",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "smith_machine",
      "bench"
    ],
    "bodyPosition": "seated",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Posicione um banco com encosto sob a barra do Smith e ajuste os limitadores. Sente-se, empurre a barra à frente da cabeça até estender os braços e desça até uma amplitude controlada, sem levar a barra atrás da nuca."
      ],
      "en": [
        "Set a supported bench under the Smith bar and adjust the stops. Sit, press the bar upward in front of the head and lower through a controlled range without moving it behind the neck."
      ],
      "es": [
        "Coloque un banco con respaldo bajo la barra Smith y ajuste los topes. Sentado, empuje la barra delante de la cabeza y baje con control sin llevarla detrás de la nuca."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "resistance-band-front-raise",
    "slug": "resistance-band-front-raise",
    "name": {
      "ptBR": "Elevação Frontal com Elástico",
      "en": "Resistance Band Front Raise",
      "es": "Elevación Frontal con Banda"
    },
    "target": {
      "primaryMuscle": "front_deltoid",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "shoulder_flexion",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "resistance_band"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Prenda o elástico sob os pés de forma estável. Com cotovelos levemente flexionados, eleve as mãos à frente até aproximadamente a altura dos ombros e retorne sem balançar o tronco."
      ],
      "en": [
        "Secure the band under the feet. With a slight elbow bend, raise the hands forward to about shoulder height and lower without swinging the torso."
      ],
      "es": [
        "Fije la banda bajo los pies. Con codos ligeramente flexionados, eleve las manos al frente hasta aproximadamente la altura de los hombros y baje sin balancear el tronco."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "cable-front-raise",
    "slug": "cable-front-raise",
    "name": {
      "ptBR": "Elevação Frontal na Polia",
      "en": "Cable Front Raise",
      "es": "Elevación Frontal en Polea"
    },
    "target": {
      "primaryMuscle": "front_deltoid",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "shoulder_flexion",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "cable"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Na polia baixa, segure a barra com o cabo passando entre as pernas e fique de costas para a torre. Eleve os braços à frente até a altura dos ombros e desça com controle, sem impulso do tronco."
      ],
      "en": [
        "At a low cable, hold a bar with the cable between the legs and face away from the stack. Raise the arms forward to shoulder height and lower under control without torso momentum."
      ],
      "es": [
        "En la polea baja, sostenga la barra con el cable entre las piernas y de espaldas a la torre. Eleve los brazos al frente hasta la altura de los hombros y baje con control sin impulso del tronco."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "machine-hip-thrust",
    "slug": "machine-hip-thrust",
    "name": {
      "ptBR": "Elevação Pélvica na Máquina",
      "en": "Machine Hip Thrust",
      "es": "Hip Thrust en Máquina"
    },
    "target": {
      "primaryMuscle": "glutes",
      "secondaryMuscles": [
        "hamstrings"
      ]
    },
    "movement": {
      "pattern": "hip_extension",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "machine"
    ],
    "bodyPosition": "lying",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Ajuste a máquina de hip thrust e posicione a proteção sobre o quadril conforme o equipamento. Com pés firmes e costas apoiadas, estenda o quadril sem hiperestender a lombar e retorne com controle."
      ],
      "en": [
        "Adjust the hip-thrust machine and place its pad over the hips as designed. Keep feet planted and back supported, extend the hips without overextending the lower back and return under control."
      ],
      "es": [
        "Ajuste la máquina de hip thrust y coloque su protección sobre la pelvis según el equipo. Con pies firmes y espalda apoyada, extienda las caderas sin hiperextender la zona lumbar y vuelva con control."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "dumbbell-shrug",
    "slug": "dumbbell-shrug",
    "name": {
      "ptBR": "Encolhimento com Halteres",
      "en": "Dumbbell Shrug",
      "es": "Encogimiento con Mancuernas"
    },
    "target": {
      "primaryMuscle": "traps",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "scapular_elevation",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "dumbbell"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Em pé com halteres ao lado do corpo, eleve os ombros em direção às orelhas sem girá-los ou flexionar os cotovelos. Desça devagar mantendo o pescoço neutro."
      ],
      "en": [
        "Stand with dumbbells at your sides, raise the shoulders toward the ears without rolling them or bending the elbows, then lower slowly with a neutral neck."
      ],
      "es": [
        "De pie con mancuernas a los lados, eleve los hombros hacia las orejas sin girarlos ni flexionar los codos y baje despacio con el cuello neutro."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "smith-machine-shrug",
    "slug": "smith-machine-shrug",
    "name": {
      "ptBR": "Encolhimento no Smith",
      "en": "Smith Machine Shrug",
      "es": "Encogimiento en Smith"
    },
    "target": {
      "primaryMuscle": "traps",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "scapular_elevation",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "smith_machine"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Ajuste a barra do Smith à altura das mãos e segure-a à frente das coxas. Eleve os ombros sem girá-los, mantenha os braços estendidos e retorne devagar."
      ],
      "en": [
        "Set the Smith bar at hand height and hold it in front of the thighs. Raise the shoulders without rolling them, keep arms straight and lower slowly."
      ],
      "es": [
        "Ajuste la barra Smith a la altura de las manos y sosténgala delante de los muslos. Eleve los hombros sin girarlos, mantenga los brazos extendidos y baje despacio."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "resistance-band-knee-extension",
    "slug": "resistance-band-knee-extension",
    "name": {
      "ptBR": "Extensão de Joelho com Elástico",
      "en": "Seated Resistance Band Knee Extension",
      "es": "Extensión de Rodilla con Banda"
    },
    "target": {
      "primaryMuscle": "quads",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "knee_extension",
      "mechanic": "isolation",
      "laterality": "unilateral"
    },
    "equipment": [
      "resistance_band",
      "chair"
    ],
    "bodyPosition": "seated",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Sente-se em cadeira estável com elástico preso ao tornozelo e ancorado atrás. Estenda um joelho sem levantar a coxa do assento e retorne devagar; repita do outro lado."
      ],
      "en": [
        "Sit on a stable chair with a band attached to the ankle and anchored behind. Extend one knee without lifting the thigh from the seat, return slowly and repeat on the other side."
      ],
      "es": [
        "Siéntese en una silla estable con la banda sujeta al tobillo y anclada detrás. Extienda una rodilla sin levantar el muslo del asiento, vuelva despacio y repita del otro lado."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "close-grip-push-up",
    "slug": "close-grip-push-up",
    "name": {
      "ptBR": "Flexão Fechada",
      "en": "Close-Grip Push-Up",
      "es": "Flexión con Manos Juntas"
    },
    "target": {
      "primaryMuscle": "triceps",
      "secondaryMuscles": [
        "chest",
        "front_deltoid"
      ]
    },
    "movement": {
      "pattern": "horizontal_push",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "bodyweight"
    ],
    "bodyPosition": "lying",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Apoie as mãos próximas uma da outra sob o peito e mantenha o corpo alinhado. Flexione os cotovelos junto ao tronco para descer e empurre o chão para retornar sem deixar o quadril cair."
      ],
      "en": [
        "Place the hands close together beneath the chest and keep the body aligned. Bend the elbows near the torso to lower and push the floor away to rise without dropping the hips."
      ],
      "es": [
        "Apoye las manos próximas bajo el pecho y mantenga el cuerpo alineado. Flexione los codos cerca del tronco para bajar y empuje el suelo para subir sin dejar caer la pelvis."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "quadruped-hip-extension",
    "slug": "quadruped-hip-extension",
    "name": {
      "ptBR": "Glúteo Quatro Apoios",
      "en": "Quadruped Hip Extension",
      "es": "Extensión de Cadera en Cuadrupedia"
    },
    "target": {
      "primaryMuscle": "glutes",
      "secondaryMuscles": [
        "hamstrings"
      ]
    },
    "movement": {
      "pattern": "hip_extension",
      "mechanic": "isolation",
      "laterality": "unilateral"
    },
    "equipment": [
      "bodyweight"
    ],
    "bodyPosition": "kneeling",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Em quatro apoios, mantenha um joelho flexionado e eleve essa coxa para trás sem girar a pelve ou arquear a lombar. Retorne e alterne o lado após a série; esta variante não usa tornozeleira."
      ],
      "en": [
        "From hands and knees, keep one knee bent and lift that thigh backward without rotating the pelvis or arching the lower back. Return and switch sides after the set; this variant uses no ankle weight."
      ],
      "es": [
        "En cuadrupedia, mantenga una rodilla flexionada y eleve ese muslo hacia atrás sin girar la pelvis ni arquear la zona lumbar. Vuelva y cambie de lado al terminar la serie; esta variante no usa lastre."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "parallel-bar-dips",
    "slug": "parallel-bar-dips",
    "name": {
      "ptBR": "Mergulho nas Paralelas",
      "en": "Parallel Bar Dips",
      "es": "Fondos en Paralelas"
    },
    "target": {
      "primaryMuscle": "triceps",
      "secondaryMuscles": [
        "chest",
        "front_deltoid"
      ]
    },
    "movement": {
      "pattern": "horizontal_push",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "bodyweight"
    ],
    "bodyPosition": "hanging",
    "difficulty": "advanced",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Use barras paralelas estáveis e sustente o corpo com os braços estendidos. Flexione os cotovelos para descer em amplitude controlada, sem afundar os ombros, e empurre as barras para voltar."
      ],
      "en": [
        "Use secure parallel bars and support the body with straight arms. Bend the elbows to lower through a controlled range without collapsing the shoulders, then push against the bars to rise."
      ],
      "es": [
        "Use barras paralelas estables y sostenga el cuerpo con los brazos extendidos. Flexione los codos para bajar con control sin hundir los hombros y empuje las barras para subir."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "standing-dumbbell-calf-raise",
    "slug": "standing-dumbbell-calf-raise",
    "name": {
      "ptBR": "Panturrilha em Pé com Halteres",
      "en": "Standing Dumbbell Calf Raise",
      "es": "Elevación de Talones con Mancuernas"
    },
    "target": {
      "primaryMuscle": "calves",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "calf_raise",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "dumbbell"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Em pé no chão com halteres ao lado do corpo, eleve os calcanhares mantendo os joelhos estáveis. Desça devagar sem balançar o tronco."
      ],
      "en": [
        "Stand on the floor with dumbbells at your sides, raise the heels while keeping the knees steady and lower slowly without swaying."
      ],
      "es": [
        "De pie en el suelo con mancuernas a los lados, eleve los talones manteniendo las rodillas estables y baje despacio sin balancearse."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "step-calf-raise",
    "slug": "step-calf-raise",
    "name": {
      "ptBR": "Panturrilha no Degrau",
      "en": "Step Calf Raise",
      "es": "Elevación de Talones en Escalón"
    },
    "target": {
      "primaryMuscle": "calves",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "calf_raise",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "step"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Apoie a parte da frente dos pés na borda de um degrau estável e use apoio para equilíbrio. Eleve os calcanhares e desça em amplitude confortável, sem saltar ou perder o apoio dos pés."
      ],
      "en": [
        "Place the forefeet on the edge of a stable step and use support for balance. Raise the heels and lower through a comfortable range without bouncing or losing foot contact."
      ],
      "es": [
        "Apoye el antepié en el borde de un escalón estable y use apoyo para el equilibrio. Eleve los talones y baje en una amplitud cómoda sin rebotes ni perder el apoyo."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "leg-press-calf-raise",
    "slug": "leg-press-calf-raise",
    "name": {
      "ptBR": "Panturrilha no Leg Press",
      "en": "Leg Press Calf Raise",
      "es": "Elevación de Talones en Prensa"
    },
    "target": {
      "primaryMuscle": "calves",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "calf_raise",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "leg_press"
    ],
    "bodyPosition": "seated",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Ajuste o leg press e seus limitadores. Apoie o antepé de forma estável na plataforma, mantenha os joelhos levemente flexionados e mova apenas os tornozelos para elevar e baixar os calcanhares com controle."
      ],
      "en": [
        "Adjust the leg press and its safety stops. Secure the forefeet on the platform, keep knees slightly bent and move only the ankles to raise and lower the heels under control."
      ],
      "es": [
        "Ajuste la prensa y sus topes de seguridad. Apoye el antepié de forma estable, mantenga las rodillas ligeramente flexionadas y mueva solo los tobillos para elevar y bajar los talones con control."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "side-plank",
    "slug": "side-plank",
    "name": {
      "ptBR": "Prancha Lateral",
      "en": "Side Plank",
      "es": "Plancha Lateral"
    },
    "target": {
      "primaryMuscle": "abs",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "core_anti_rotation",
      "mechanic": "compound",
      "laterality": "unilateral"
    },
    "equipment": [
      "bodyweight"
    ],
    "bodyPosition": "lying",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "De lado, apoie o antebraço com cotovelo sob o ombro e mantenha as pernas estendidas. Eleve o quadril para alinhar o corpo, sustente pelo tempo prescrito sem girar o tronco e repita do outro lado."
      ],
      "en": [
        "Lie on your side, support the forearm with elbow under shoulder and keep legs straight. Raise the hips to align the body, hold for the prescribed time without rotating and repeat on the other side."
      ],
      "es": [
        "De lado, apoye el antebrazo con el codo bajo el hombro y las piernas extendidas. Eleve la pelvis para alinear el cuerpo, mantenga durante el tiempo indicado sin girarse y repita del otro lado."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "dumbbell-pullover",
    "slug": "dumbbell-pullover",
    "name": {
      "ptBR": "Pullover com Halter",
      "en": "Dumbbell Pullover",
      "es": "Pullover con Mancuerna"
    },
    "target": {
      "primaryMuscle": "lats",
      "secondaryMuscles": [
        "chest",
        "triceps"
      ]
    },
    "movement": {
      "pattern": "vertical_pull",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "dumbbell",
      "bench"
    ],
    "bodyPosition": "lying",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Deite-se longitudinalmente no banco com pés apoiados e segure um halter acima do peito. Com cotovelos levemente flexionados, leve os braços para trás em amplitude controlada e retorne sem arquear a lombar."
      ],
      "en": [
        "Lie lengthwise on a bench with feet supported and hold a dumbbell above the chest. Keep a slight elbow bend, lower the arms overhead through a controlled range and return without arching the lower back."
      ],
      "es": [
        "Acuéstese longitudinalmente en el banco con los pies apoyados y sostenga una mancuerna sobre el pecho. Con codos ligeramente flexionados, lleve los brazos atrás con control y vuelva sin arquear la zona lumbar."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "straight-arm-cable-pulldown",
    "slug": "straight-arm-cable-pulldown",
    "name": {
      "ptBR": "Pullover na Polia",
      "en": "Straight-Arm Cable Pulldown",
      "es": "Pullover en Polea"
    },
    "target": {
      "primaryMuscle": "lats",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "vertical_pull",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "cable"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Na polia alta, segure a barra e recue para manter tensão. Com cotovelos levemente flexionados e estáveis, traga os braços em arco até as coxas e retorne sem transformar o movimento em uma remada."
      ],
      "en": [
        "Hold a high-cable bar and step back to maintain tension. Keep elbows slightly bent and fixed, bring the arms in an arc toward the thighs and return without turning the motion into a row."
      ],
      "es": [
        "Sostenga la barra de la polea alta y retroceda para mantener tensión. Con codos ligeramente flexionados y fijos, lleve los brazos en arco hacia los muslos y vuelva sin convertir el movimiento en un remo."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "dumbbell-upright-row",
    "slug": "dumbbell-upright-row",
    "name": {
      "ptBR": "Remada Alta com Halteres",
      "en": "Dumbbell Upright Row",
      "es": "Remo al Mentón con Mancuernas"
    },
    "target": {
      "primaryMuscle": "side_deltoid",
      "secondaryMuscles": [
        "traps"
      ]
    },
    "movement": {
      "pattern": "shoulder_abduction",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "dumbbell"
    ],
    "bodyPosition": "standing",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Em pé com halteres à frente das coxas, eleve os cotovelos lateralmente levando os halteres próximos ao corpo. Pare em amplitude confortável, sem elevar os cotovelos acima dos ombros, e retorne devagar."
      ],
      "en": [
        "Stand with dumbbells in front of the thighs and lift elbows out to the sides, keeping the weights close. Stop at a comfortable range without lifting elbows above shoulders, then lower slowly."
      ],
      "es": [
        "De pie con mancuernas delante de los muslos, eleve los codos lateralmente manteniendo las pesas cerca. Pare en una amplitud cómoda sin superar los hombros con los codos y baje despacio."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "bent-over-barbell-row",
    "slug": "bent-over-barbell-row",
    "name": {
      "ptBR": "Remada Curvada com Barra",
      "en": "Bent-Over Barbell Row",
      "es": "Remo Inclinado con Barra"
    },
    "target": {
      "primaryMuscle": "upper_back",
      "secondaryMuscles": [
        "lats",
        "rear_deltoid",
        "biceps"
      ]
    },
    "movement": {
      "pattern": "horizontal_pull",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "barbell"
    ],
    "bodyPosition": "standing",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Segure a barra com pegada pronada, flexione levemente os joelhos e incline o tronco pelo quadril. Puxe a barra em direção ao abdômen sem levantar o tronco e estenda os braços com controle."
      ],
      "en": [
        "Hold the bar with an overhand grip, bend knees slightly and hinge the torso forward. Pull the bar toward the abdomen without raising the torso, then extend the arms under control."
      ],
      "es": [
        "Sostenga la barra con agarre prono, flexione ligeramente las rodillas e incline el tronco desde la cadera. Tire hacia el abdomen sin levantar el tronco y extienda los brazos con control."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "resistance-band-biceps-curl",
    "slug": "resistance-band-biceps-curl",
    "name": {
      "ptBR": "Rosca Direta com Elástico",
      "en": "Resistance Band Biceps Curl",
      "es": "Curl de Bíceps con Banda"
    },
    "target": {
      "primaryMuscle": "biceps",
      "secondaryMuscles": [
        "forearms"
      ]
    },
    "movement": {
      "pattern": "elbow_flexion",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "resistance_band"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Prenda o elástico sob os pés e segure-o com palmas voltadas para a frente. Flexione os cotovelos mantendo-os junto ao corpo e retorne devagar sem balançar o tronco."
      ],
      "en": [
        "Secure the band under the feet with palms facing forward. Bend the elbows while keeping them near the torso and lower slowly without swinging."
      ],
      "es": [
        "Fije la banda bajo los pies con palmas hacia delante. Flexione los codos manteniéndolos junto al cuerpo y baje despacio sin balancear el tronco."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "cable-rope-hammer-curl",
    "slug": "cable-rope-hammer-curl",
    "name": {
      "ptBR": "Rosca Martelo na Polia",
      "en": "Cable Rope Hammer Curl",
      "es": "Curl Martillo en Polea"
    },
    "target": {
      "primaryMuscle": "biceps",
      "secondaryMuscles": [
        "forearms"
      ]
    },
    "movement": {
      "pattern": "elbow_flexion",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "cable"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Na polia baixa com corda, mantenha as palmas voltadas uma para a outra. Flexione os cotovelos sem mover os braços junto ao tronco e retorne com controle."
      ],
      "en": [
        "Use a rope on a low cable with palms facing each other. Bend the elbows without moving the upper arms beside the torso and return under control."
      ],
      "es": [
        "Use una cuerda en la polea baja con palmas enfrentadas. Flexione los codos sin mover los brazos junto al tronco y vuelva con control."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "barbell-stiff-leg-deadlift",
    "slug": "barbell-stiff-leg-deadlift",
    "name": {
      "ptBR": "Stiff com Barra",
      "en": "Barbell Stiff-Leg Deadlift",
      "es": "Peso Muerto Rígido con Barra"
    },
    "target": {
      "primaryMuscle": "hamstrings",
      "secondaryMuscles": [
        "glutes",
        "lower_back"
      ]
    },
    "movement": {
      "pattern": "hinge",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "barbell"
    ],
    "bodyPosition": "standing",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Em pé com barra à frente das coxas, mantenha os joelhos levemente flexionados e estáveis. Leve o quadril para trás para descer a barra próxima às pernas e retorne pela extensão do quadril; não parta do chão como no terra convencional."
      ],
      "en": [
        "Stand with a bar in front of the thighs and keep knees slightly bent and fixed. Move hips backward to lower the bar close to the legs, then extend hips to rise; do not start from the floor as in a conventional deadlift."
      ],
      "es": [
        "De pie con la barra delante de los muslos, mantenga las rodillas ligeramente flexionadas y fijas. Lleve la cadera atrás bajando la barra cerca de las piernas y extienda las caderas para subir; no empiece desde el suelo como en el peso muerto convencional."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "superman",
    "slug": "superman",
    "name": {
      "ptBR": "Superman",
      "en": "Superman",
      "es": "Superman"
    },
    "target": {
      "primaryMuscle": "lower_back",
      "secondaryMuscles": [
        "glutes",
        "upper_back"
      ]
    },
    "movement": {
      "pattern": "hip_extension",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "bodyweight"
    ],
    "bodyPosition": "lying",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Deite-se de barriga para baixo com braços à frente. Eleve discretamente braços e pernas mantendo o pescoço alinhado, sem impulso, e retorne ao chão com controle."
      ],
      "en": [
        "Lie face down with arms overhead. Gently lift arms and legs with the neck aligned, avoid momentum and lower to the floor under control."
      ],
      "es": [
        "Acuéstese boca abajo con brazos al frente. Eleve suavemente brazos y piernas con el cuello alineado, sin impulso, y vuelva al suelo con control."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "close-grip-barbell-bench-press",
    "slug": "close-grip-barbell-bench-press",
    "name": {
      "ptBR": "Supino Fechado",
      "en": "Close-Grip Barbell Bench Press",
      "es": "Press de Banca con Agarre Cerrado"
    },
    "target": {
      "primaryMuscle": "triceps",
      "secondaryMuscles": [
        "chest",
        "front_deltoid"
      ]
    },
    "movement": {
      "pattern": "horizontal_push",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "barbell",
      "bench"
    ],
    "bodyPosition": "lying",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Deite-se no banco reto com pés firmes e segure a barra com pegada próxima à largura dos ombros. Desça em direção ao peito mantendo cotovelos próximos ao tronco e empurre para cima sem retirar o apoio das costas."
      ],
      "en": [
        "Lie on a flat bench with feet planted and grip the bar near shoulder width. Lower toward the chest with elbows near the torso and press upward while keeping the back supported."
      ],
      "es": [
        "Acuéstese en un banco plano con pies firmes y agarre la barra cerca del ancho de los hombros. Baje hacia el pecho con codos próximos al tronco y empuje sin perder el apoyo de la espalda."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "incline-barbell-bench-press",
    "slug": "incline-barbell-bench-press",
    "name": {
      "ptBR": "Supino Inclinado com Barra",
      "en": "Incline Barbell Bench Press",
      "es": "Press Inclinado con Barra"
    },
    "target": {
      "primaryMuscle": "chest",
      "secondaryMuscles": [
        "front_deltoid",
        "triceps"
      ],
      "primaryRegion": "upper_chest"
    },
    "movement": {
      "pattern": "horizontal_push",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "barbell",
      "bench"
    ],
    "bodyPosition": "lying",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Ajuste o banco inclinado e deite-se com pés firmes. Segure a barra com pegada pronada, desça em direção à parte superior do peito e empurre para cima mantendo as costas apoiadas."
      ],
      "en": [
        "Lie on an inclined bench with feet planted. Hold the bar with an overhand grip, lower toward the upper chest and press up while keeping the back supported."
      ],
      "es": [
        "Acuéstese en un banco inclinado con pies firmes. Sostenga la barra con agarre prono, baje hacia la parte superior del pecho y empuje manteniendo la espalda apoyada."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "barbell-flat-bench-press",
    "slug": "barbell-flat-bench-press",
    "name": {
      "ptBR": "Supino Reto com Barra",
      "en": "Barbell Flat Bench Press",
      "es": "Press de Banca Plano con Barra"
    },
    "target": {
      "primaryMuscle": "chest",
      "secondaryMuscles": [
        "front_deltoid",
        "triceps"
      ],
      "primaryRegion": "mid_chest"
    },
    "movement": {
      "pattern": "horizontal_push",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "barbell",
      "bench"
    ],
    "bodyPosition": "lying",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Deite-se no banco reto com pés firmes e segure a barra com pegada pronada. Desça a barra em direção ao peito com controle e empurre para cima mantendo as costas apoiadas."
      ],
      "en": [
        "Lie on a flat bench with feet planted and hold the bar with an overhand grip. Lower toward the chest under control and press up while keeping the back supported."
      ],
      "es": [
        "Acuéstese en un banco plano con pies firmes y agarre la barra en pronación. Baje hacia el pecho con control y empuje manteniendo la espalda apoyada."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "dumbbell-triceps-kickback",
    "slug": "dumbbell-triceps-kickback",
    "name": {
      "ptBR": "Tríceps Coice com Halter",
      "en": "Dumbbell Triceps Kickback",
      "es": "Patada de Tríceps con Mancuerna"
    },
    "target": {
      "primaryMuscle": "triceps",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "elbow_extension",
      "mechanic": "isolation",
      "laterality": "unilateral"
    },
    "equipment": [
      "dumbbell",
      "bench"
    ],
    "bodyPosition": "standing",
    "difficulty": "beginner",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Apoie uma mão no banco e incline o tronco, com o braço de trabalho junto ao corpo. Estenda o cotovelo para levar o halter para trás sem mover o ombro e retorne devagar."
      ],
      "en": [
        "Support one hand on a bench and hinge forward with the working upper arm beside the torso. Extend the elbow to move the dumbbell backward without moving the shoulder and return slowly."
      ],
      "es": [
        "Apoye una mano en el banco e incline el tronco con el brazo de trabajo junto al cuerpo. Extienda el codo llevando la mancuerna atrás sin mover el hombro y vuelva despacio."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "lying-dumbbell-triceps-extension",
    "slug": "lying-dumbbell-triceps-extension",
    "name": {
      "ptBR": "Tríceps Testa com Halteres",
      "en": "Lying Dumbbell Triceps Extension",
      "es": "Extensión de Tríceps Acostado con Mancuernas"
    },
    "target": {
      "primaryMuscle": "triceps",
      "secondaryMuscles": []
    },
    "movement": {
      "pattern": "elbow_extension",
      "mechanic": "isolation",
      "laterality": "bilateral"
    },
    "equipment": [
      "dumbbell",
      "bench"
    ],
    "bodyPosition": "lying",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Deite-se no banco reto segurando os halteres acima dos ombros com palmas enfrentadas. Flexione os cotovelos levando os halteres ao lado da cabeça e estenda os braços sem abrir os cotovelos ou mover o tronco."
      ],
      "en": [
        "Lie on a flat bench holding dumbbells above the shoulders with palms facing each other. Bend elbows to lower the weights beside the head, then extend without flaring elbows or moving the torso."
      ],
      "es": [
        "Acuéstese en un banco plano con mancuernas sobre los hombros y palmas enfrentadas. Flexione los codos llevando las pesas junto a la cabeza y extienda sin abrir los codos ni mover el tronco."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "dumbbell-flat-bench-press",
    "slug": "dumbbell-flat-bench-press",
    "name": {
      "ptBR": "Supino Reto com Halteres",
      "en": "Dumbbell Flat Bench Press",
      "es": "Press Plano con Mancuernas"
    },
    "target": {
      "primaryMuscle": "chest",
      "secondaryMuscles": [
        "front_deltoid",
        "triceps"
      ],
      "primaryRegion": "mid_chest"
    },
    "movement": {
      "pattern": "horizontal_push",
      "mechanic": "compound",
      "laterality": "bilateral"
    },
    "equipment": [
      "dumbbell",
      "bench"
    ],
    "bodyPosition": "lying",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Deite-se em banco reto com pés firmes e halteres ao lado do peito. Empurre os halteres para cima e desça com controle mantendo as costas apoiadas; esta execução é no banco, não no chão."
      ],
      "en": [
        "Lie on a flat bench with feet planted and dumbbells beside the chest. Press up and lower under control with the back supported; this is a bench press, not a floor press."
      ],
      "es": [
        "Acuéstese en un banco plano con pies firmes y mancuernas junto al pecho. Empuje hacia arriba y baje con control con la espalda apoyada; se realiza en banco, no en el suelo."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  },
  {
    "id": "single-leg-bench-hip-thrust",
    "slug": "single-leg-bench-hip-thrust",
    "name": {
      "ptBR": "Elevação Pélvica Unilateral",
      "en": "Single-Leg Bench Hip Thrust",
      "es": "Hip Thrust Unilateral en Banco"
    },
    "target": {
      "primaryMuscle": "glutes",
      "secondaryMuscles": [
        "hamstrings"
      ]
    },
    "movement": {
      "pattern": "hip_extension",
      "mechanic": "compound",
      "laterality": "unilateral"
    },
    "equipment": [
      "bodyweight",
      "bench"
    ],
    "bodyPosition": "lying",
    "difficulty": "intermediate",
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "execution": {},
    "instructions": {
      "ptBR": [
        "Apoie a parte superior das costas em banco estável, mantenha um pé no chão e a outra perna elevada. Estenda o quadril sem girar a pelve ou hiperestender a lombar, desça com controle e repita do outro lado."
      ],
      "en": [
        "Support the upper back on a stable bench with one foot planted and the other leg raised. Extend the hip without rotating the pelvis or overextending the lower back, lower under control and repeat on the other side."
      ],
      "es": [
        "Apoye la parte superior de la espalda en un banco estable, con un pie firme y la otra pierna elevada. Extienda la cadera sin girar la pelvis ni hiperextender la zona lumbar, baje con control y repita del otro lado."
      ]
    },
    "substitution": {
      "similarExerciseIds": []
    }
  }
];

export const EXERCISES_V3_DRAFT: ExerciseSeedInput[] = resistanceDrafts.map((exercise) => ({
  ...exercise,
}));

type BlockedActivity = CanonicalActivity & Pick<ExerciseSeedInput,
  'status' | 'availability' | 'equipment' | 'difficulty' | 'execution'>;

const cardioDrafts: BlockedActivity[] = [
  {
    "id": "running-in-place",
    "kind": "cardio",
    "name": {
      "ptBR": "Corrida Estacionária",
      "en": "Running in Place",
      "es": "Carrera en el Sitio"
    },
    "instructions": {
      "ptBR": [
        "Corra sem deslocar-se, alternando as pernas e coordenando os braços. Mantenha o tronco estável e aterrissagens controladas pelo tempo prescrito."
      ],
      "en": [
        "Run in place, alternating legs and coordinating the arms. Keep the torso stable and land under control for the prescribed time."
      ],
      "es": [
        "Corra en el sitio alternando las piernas y coordinando los brazos. Mantenga el tronco estable y aterrice con control durante el tiempo indicado."
      ]
    },
    "guidedSequenceAvailable": false,
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "equipment": [
      "bodyweight"
    ],
    "difficulty": "beginner",
    "execution": {}
  },
  {
    "id": "elliptical-trainer",
    "kind": "cardio",
    "name": {
      "ptBR": "Elíptico",
      "en": "Elliptical Trainer",
      "es": "Elíptica"
    },
    "instructions": {
      "ptBR": [
        "Suba no aparelho elíptico parado usando os apoios. Inicie passadas contínuas mantendo os pés nas plataformas e ajuste a resistência conforme a prescrição; reduza o ritmo antes de descer."
      ],
      "en": [
        "Mount the stationary elliptical using its supports. Begin continuous strides with feet on the platforms and adjust resistance as prescribed; slow down before dismounting."
      ],
      "es": [
        "Suba a la elíptica detenida usando sus apoyos. Inicie zancadas continuas manteniendo los pies en las plataformas y ajuste la resistencia según la prescripción; reduzca el ritmo antes de bajar."
      ]
    },
    "guidedSequenceAvailable": false,
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "equipment": [
      "machine"
    ],
    "difficulty": "beginner",
    "execution": {}
  },
  {
    "id": "jumping-jack",
    "kind": "cardio",
    "name": {
      "ptBR": "Polichinelo",
      "en": "Jumping Jack",
      "es": "Salto de Tijera"
    },
    "instructions": {
      "ptBR": [
        "Partindo de pés juntos e braços ao lado do corpo, salte abrindo as pernas e elevando os braços. Retorne à posição inicial com aterrissagens controladas e repita pelo tempo prescrito."
      ],
      "en": [
        "Start with feet together and arms at your sides. Jump to spread the legs and raise the arms, return with controlled landings and repeat for the prescribed time."
      ],
      "es": [
        "Empiece con pies juntos y brazos a los lados. Salte separando las piernas y elevando los brazos, vuelva con aterrizajes controlados y repita durante el tiempo indicado."
      ]
    },
    "guidedSequenceAvailable": false,
    "status": "draft",
    "availability": {
      "workoutGeneration": false,
      "manualSelection": false,
      "substitution": false
    },
    "equipment": [
      "bodyweight"
    ],
    "difficulty": "beginner",
    "execution": {}
  }
];

export const ACTIVITIES_V3_DRAFT: BlockedActivity[] = cardioDrafts.map((activity) => ({
  ...activity,
}));

/** Review metadata: existing catalogs do not store an editorial environment or prescription unit.
 * Uses existing environment values and prescription field names; never consumed by runtime. */
export const V3_DRAFT_METADATA: Record<string, {
  environments: TemplateEnvironment[];
  prescriptionField: keyof Pick<FinalWorkoutExercise, 'reps' | 'duration'>;
}> = {
  "cable-hip-abduction": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "cable-hip-adduction": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "dumbbell-stationary-lunge": {
    "environments": [
      "gym",
      "home"
    ],
    "prescriptionField": "reps"
  },
  "dumbbell-sumo-squat": {
    "environments": [
      "gym",
      "home"
    ],
    "prescriptionField": "reps"
  },
  "pull-up": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "wall-sit": {
    "environments": [
      "home"
    ],
    "prescriptionField": "duration"
  },
  "reverse-pec-deck": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "resistance-band-chest-fly": {
    "environments": [
      "home"
    ],
    "prescriptionField": "reps"
  },
  "arnold-dumbbell-press": {
    "environments": [
      "gym",
      "home"
    ],
    "prescriptionField": "reps"
  },
  "smith-machine-shoulder-press": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "resistance-band-front-raise": {
    "environments": [
      "gym",
      "home"
    ],
    "prescriptionField": "reps"
  },
  "cable-front-raise": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "machine-hip-thrust": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "dumbbell-shrug": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "smith-machine-shrug": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "resistance-band-knee-extension": {
    "environments": [
      "gym",
      "home"
    ],
    "prescriptionField": "reps"
  },
  "close-grip-push-up": {
    "environments": [
      "gym",
      "home"
    ],
    "prescriptionField": "reps"
  },
  "quadruped-hip-extension": {
    "environments": [
      "gym",
      "home"
    ],
    "prescriptionField": "reps"
  },
  "parallel-bar-dips": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "standing-dumbbell-calf-raise": {
    "environments": [
      "home"
    ],
    "prescriptionField": "reps"
  },
  "step-calf-raise": {
    "environments": [
      "home"
    ],
    "prescriptionField": "reps"
  },
  "leg-press-calf-raise": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "side-plank": {
    "environments": [
      "gym",
      "home"
    ],
    "prescriptionField": "duration"
  },
  "dumbbell-pullover": {
    "environments": [
      "gym",
      "home"
    ],
    "prescriptionField": "reps"
  },
  "straight-arm-cable-pulldown": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "dumbbell-upright-row": {
    "environments": [
      "home"
    ],
    "prescriptionField": "reps"
  },
  "bent-over-barbell-row": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "resistance-band-biceps-curl": {
    "environments": [
      "home"
    ],
    "prescriptionField": "reps"
  },
  "cable-rope-hammer-curl": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "barbell-stiff-leg-deadlift": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "superman": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "close-grip-barbell-bench-press": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "incline-barbell-bench-press": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "barbell-flat-bench-press": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "reps"
  },
  "dumbbell-triceps-kickback": {
    "environments": [
      "home"
    ],
    "prescriptionField": "reps"
  },
  "lying-dumbbell-triceps-extension": {
    "environments": [
      "home"
    ],
    "prescriptionField": "reps"
  },
  "dumbbell-flat-bench-press": {
    "environments": [
      "gym",
      "home"
    ],
    "prescriptionField": "reps"
  },
  "single-leg-bench-hip-thrust": {
    "environments": [
      "home"
    ],
    "prescriptionField": "reps"
  },
  "running-in-place": {
    "environments": [
      "home"
    ],
    "prescriptionField": "duration"
  },
  "elliptical-trainer": {
    "environments": [
      "gym"
    ],
    "prescriptionField": "duration"
  },
  "jumping-jack": {
    "environments": [
      "home"
    ],
    "prescriptionField": "duration"
  }
};
