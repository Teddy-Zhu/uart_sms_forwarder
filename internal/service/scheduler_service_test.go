package service

import (
	"testing"
	"time"

	"github.com/dushixiang/uart_sms_forwarder/internal/models"
)

func TestNextIntervalDaysTime(t *testing.T) {
	startAt := time.Date(2026, 1, 1, 8, 0, 0, 0, time.UTC)
	task := models.ScheduledTask{
		ScheduleType: models.ScheduledScheduleTypeIntervalDays,
		IntervalDays: 3,
		StartAt:      startAt.UnixMilli(),
	}

	tests := []struct {
		name string
		now  time.Time
		want time.Time
	}{
		{
			name: "future start",
			now:  time.Date(2025, 12, 31, 8, 0, 0, 0, time.UTC),
			want: startAt,
		},
		{
			name: "between intervals",
			now:  time.Date(2026, 1, 2, 9, 0, 0, 0, time.UTC),
			want: time.Date(2026, 1, 4, 8, 0, 0, 0, time.UTC),
		},
		{
			name: "on boundary",
			now:  time.Date(2026, 1, 4, 8, 0, 0, 0, time.UTC),
			want: time.Date(2026, 1, 7, 8, 0, 0, 0, time.UTC),
		},
		{
			name: "after multiple intervals",
			now:  time.Date(2026, 1, 10, 9, 0, 0, 0, time.UTC),
			want: time.Date(2026, 1, 13, 8, 0, 0, 0, time.UTC),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := nextIntervalDaysTime(task, tt.now)
			if !ok {
				t.Fatal("nextIntervalDaysTime returned false")
			}
			if !got.Equal(tt.want) {
				t.Fatalf("nextIntervalDaysTime() = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestNextIntervalDaysTimeInvalid(t *testing.T) {
	now := time.Date(2026, 1, 1, 8, 0, 0, 0, time.UTC)
	task := models.ScheduledTask{
		ScheduleType: models.ScheduledScheduleTypeIntervalDays,
		IntervalDays: 0,
		StartAt:      now.UnixMilli(),
	}

	if _, ok := nextIntervalDaysTime(task, now); ok {
		t.Fatal("nextIntervalDaysTime returned true for invalid interval")
	}
}
